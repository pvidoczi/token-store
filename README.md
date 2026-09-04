# Token Store

Ez a repository a Figma bridge és a frontend projekt közötti átadó pipeline. 

## Könyvtárstruktúra

A Figma export két könyvtára közvetlenül a repository gyökerébe kerül:

```text
foundations/
├── base/base.json
├── smc-colors/{dark,light}.json
├── smc-layout/{small,medium,large,xlarge}.json
└── smc-reference/smc-reference.json
components/
└── <komponens>/{comp-color,comp-size}/*.json
```

Üres bemenettel a parser sikeresen leáll és nem készít CSS-t. A `foundations/**` vagy `components/**` alatti push automatikusan elindítja a GitLab parse jobot. A teljes pipeline a GitLab **Build > Pipelines > New pipeline** felületéről manuálisan is indítható. Beérkező tokenek esetén az `ids_css` könyvtárba generálja a fájlokat, artifactként eltárolja, majd `[skip ci]` commitban visszapusholja az aktuális branchre.

## Helyi használat

```bash
npm ci
npm run parse
```

Ha egy másik bemeneti gyökér alatt található a `foundation` és a `components`, az a `FIGMA_INPUT_DIR` változóval adható meg. A kimenet a `CSS_OUTPUT_DIR` változóval írható felül.

## GitLab pipeline és publikálás

A `parse_tokens` job automatikus. Az elkészült CSS hét napig letölthető pipeline artifactként. A `publish_tokens` job mindig manuális (`when: manual`), tehát a parse befejezése önmagában soha nem pushol a célrepóba. Publikáláskor a job klónozza a célrepót, lecseréli a cél CSS-könyvtár tartalmát, és csak tényleges változás esetén commitol és pushol.

A saját repóba történő pushhoz a GitLab projektben engedélyezni kell, hogy a projekt saját `CI_JOB_TOKEN`-je pusholhasson. Alternatívaként a hitelesített clone URL a masked `SELF_REPO_URL` CI/CD változóban adható meg. A tokent használó identitásnak az aktuális (protected) branchre is pushjoggal kell rendelkeznie.

Helyileg a `npm run publish` előbb parse-ol, majd publikál. A CI ugyanannak a pipeline-nak a már elkészült artifactját használja.

Kötelező konfiguráció:

- `TARGET_REPO_URL`: a cél GitLab repository hitelesített clone URL-je.

Opcionális konfiguráció:

- `TARGET_REPO_BRANCH` (alapérték: `IDS_CSS`; ha még nem létezik, a publish job létrehozza)
- `TARGET_CSS_PATH` (alapérték: `projects/demo/src/assets/ids_css`)
- `TARGET_CHECKOUT_DIR` (alapérték: `target-repo`)
- `TARGET_COMMIT_MESSAGE`
- `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`

A célrepo nincs beégetve sem a scriptbe, sem a pipeline-ba. A GitLab projekt **Settings > CI/CD > Variables** részében kell felvenni a `TARGET_REPO_URL` változót. Ha az URL credentialt vagy deploy tokent tartalmaz, legyen **Masked** és szükség szerint **Protected**. Ugyanitt adható meg opcionálisan a `TARGET_REPO_BRANCH` és a `TARGET_CSS_PATH`. Valódi tokent nem szabad a repositoryba commitolni.

## IDS Styles token validáció

A `validate_ids_styles_tokens` job a generált komponens CSS-változókat hasonlítja össze az `ids-styles` lefordított CSS-ében található komponens-token hivatkozásokkal. Az összehasonlítás kizárólag a `--ids-comp-*` tokenekre terjed ki; a komponens tokenek alapjául szolgáló `base` és `smc` tokenek kimaradnak a darabszámokból és mindkét eltéréslistából. A job az `ids-styles` saját buildjét futtatja, ezért a Sass ciklusok és interpolációk már feloldott CSS-ként kerülnek az ellenőrzésbe.

### Futtatás GitLabon

1. Nyisd meg a projekt **Build > Pipelines** oldalát, majd kattints a **New pipeline** gombra.
2. A **Run for branch name or tag** mezőben válaszd ki ennek a token-store repositorynak azt a branchét vagy tagjét, amelynek a tokenjeit ellenőrizni szeretnéd. Ez nem az `ids-styles` verziója.
3. Az `IDS_STYLES_REF` változót kétféleképpen adhatod meg:
    - **Projektváltozóként** a **Settings > CI/CD > Variables** résznél.
    - **Csak az aktuális pipeline futtatásához** a **New pipeline** oldalon, a **Variables** szekcióban:
        - **Variable type:** `Variable`
        - **Variable key:** `IDS_STYLES_REF`
        - **Variable value:** az `ids-styles` kívánt branche, tagje vagy commit SHA-ja, például `main` vagy `0.0.74`.
4. Kattints a **New pipeline** gombra a pipeline létrehozásához.
5. A létrejött pipeline-ban indítsd el a `validate_ids_styles_tokens` manuális jobot a **Run** vagy a lejátszás ikonra kattintva.

A job kimenete tartalmazza mindkét eltérés rendezett listáját. A `token-diff-report.json` machine-readable artifact sikeres és sikertelen validáció után is letölthető a job oldaláról.

### A riport listáinak értelmezése

A validátor mindkét oldalon egyedi tokennevekből álló halmazt készít, ezért ugyanaz a token akkor is csak egyszer szerepel a riportban, ha több komponens vagy CSS-fájl hivatkozik rá. A listák alfabetikusan rendezettek, és csak `--ids-comp-*` komponens tokeneket tartalmaznak.

#### Az IDS Styles hivatkozik rá, de hiányzik a generált CSS-ből

A piros, `Referenced by ids-styles but missing from generated CSS` lista olyan komponens tokeneket tartalmaz, amelyekre a kiválasztott `ids-styles` ref lefordított CSS-e `var(--ids-comp-...)` formában hivatkozik, de az aktuális token-store forrásokból generált CSS nem definiálja őket.

Például az IDS Styles tartalmazza ezt:

```css
.ids-button {
  height: var(--ids-comp-button-size-height-compact);
}
```

de a generált CSS-ből hiányzik ez a definíció:

```css
:root {
  --ids-comp-button-size-height-compact: 32px;
}
```

Ilyenkor a CSS-változó nem oldható fel a generált tokenkészletből. Ez jelenthet hiányzó vagy átnevezett tokent, elavult IDS Styles hivatkozást, illetve egymással nem kompatibilis token-store és IDS Styles verziót. Ha ez a lista nem üres, a validációs job hibával leáll.

#### Generált, de az IDS Styles által közvetlenül nem hivatkozott

A cián, `Defined in generated CSS but not directly referenced by ids-styles` lista olyan komponens tokeneket tartalmaz, amelyeket az aktuális token-store sikeresen legenerált, de a kiválasztott `ids-styles` ref lefordított CSS-ében nincs rájuk közvetlen `var(--ids-comp-...)` hivatkozás.

Például a generált CSS tartalmazza ezt:

```css
:root {
  --ids-comp-button-size-height-extra-large: 48px;
}
```

de az IDS Styles lefordított CSS-e sehol nem tartalmazza ezt:

```css
var(--ids-comp-button-size-height-extra-large)
```

Ez önmagában nem jelenti azt, hogy a token biztosan használatlan. Lehet, hogy egy másik IDS Styles verzió, egy még nem implementált komponens vagy variáns, illetve az IDS Styles-on kívüli fogyasztó használja. Ez a lista ezért csak információs: a tartalma nem buktatja el a jobot.

### Az IDS Styles verziójának megadása

Az `IDS_STYLES_REF` értéke az `ids-styles` repository bármely elérhető Git branch-, tag- vagy commit SHA-azonosítója lehet:

- Branch, például `main`: minden futás az adott branch aktuális commitját ellenőrzi.
- Tag, például `0.0.74`: egy kiadáshoz rögzített, reprodukálható ellenőrzést ad. A megadott tagnek léteznie kell az `ids-styles` repositoryban.
- Commit SHA, például `32d74f7a082cda8eda3d72bef07c3ebc8b19a109`: pontosan a megadott commitot ellenőrzi. Reprodukálható futtatáshoz a teljes SHA használata ajánlott.

A ref kétféleképpen konfigurálható:

1. Tartós alapértékként a projekt **Settings > CI/CD > Variables** részében add hozzá az `IDS_STYLES_REF` változót. Például:

   ```text
   Key: IDS_STYLES_REF
   Value: main
   ```

2. Egyetlen futtatáshoz a **New pipeline** oldalon, a pipeline-változók között add meg vagy írd felül az értékét. Például egy taggel:

   ```text
   Key: IDS_STYLES_REF
   Value: 0.0.74
   ```

Az aktuális pipeline-hoz megadott változóval a tartós projektbeállítás futtatásonként felülírható. Ha az `IDS_STYLES_REF` nincs beállítva, vagy a megadott ref nem checkoutolható, a validáció egyértelmű hibaüzenettel leáll.

## GitHub Actions pipeline és publikálás

A repository GitLab mellett GitHub Actions-ön is futtatható, a `.github/workflows/tokens.yml` workflow-val. Ez **kizárólag adapter réteg**: ugyanazokat az npm scripteket és `scripts/` alatti fájlokat hívja, mint a GitLab pipeline, így a két platform mindig azonos üzleti logikát futtat. A `.gitlab-ci.yml` és a GitLab-specifikus beállítások ettől függetlenül, változatlanul működnek tovább.

### Jobok és trigger-viselkedés

| Job | Trigger | GitLab megfelelő |
|-----|---------|-------------------|
| `parse_tokens` | Automatikus push-ra (`foundations/**`, `components/**`, `scripts/**`, stb.) és manuális `workflow_dispatch`-re is | `parse_tokens` (automatikus) |
| `validate_ids_styles_tokens` | Csak manuális `workflow_dispatch` futtatáson jelenik meg, és a `validate-ids-styles` Environmenthez van kötve | `validate_ids_styles_tokens` (csak web forrás, manuális) |
| `publish_tokens` | Mindig a `publish-tokens` Environment jóváhagyásához kötött, push és `workflow_dispatch` esetén is | `publish_tokens` (`when: manual`) |

A `parse_tokens` job a generált CSS-t — a GitLab `commit-generated-css.sh` scripttel megegyező logikával — visszacommitolja a forrás branch-re, kivéve ha a branch védett (ezt a job a GitHub API-n keresztül próbálja megállapítani; bizonytalan esetben a job biztonságból védettnek tekinti a branch-et, és kihagyja a visszacommitolást).

### Szükséges GitHub beállítások

1. **Environments létrehozása jóváhagyással** (Settings > Environments):
   - `publish-tokens` — állíts be **Required reviewers**-t, hogy a publikálás valóban emberi jóváhagyáshoz legyen kötve (ez felel meg a GitLab `when: manual` gombjának).
   - `validate-ids-styles` — opcionálisan szintén elláthatod jóváhagyással.

2. **Repository Secrets** (Settings > Secrets and variables > Actions > Secrets):
   - `TARGET_REPO_URL` — a cél repository hitelesített clone URL-je (pl. GitHub esetén egy fine-grained personal access token-nel vagy deploy key-jel).

3. **Repository Variables** (Settings > Secrets and variables > Actions > Variables) — mind opcionális, a GitLab CI/CD változóival megegyező névvel és alapértékkel:
   - `TARGET_REPO_BRANCH` (alapérték a scriptben: `IDS_CSS`)
   - `TARGET_CSS_PATH` (alapérték: `projects/demo/src/assets/ids_css`)
   - `TARGET_CHECKOUT_DIR` (alapérték: `target-repo`)
   - `TARGET_COMMIT_MESSAGE`
   - `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`
   - `IDS_STYLES_REF` — a `validate_ids_styles_tokens` jobhoz; egyetlen futtatásra felülírható a **Run workflow** ablak `ids_styles_ref` mezőjében is.

4. **`GITHUB_TOKEN` jogosultság a saját repóba történő visszacommitoláshoz**: a `parse_tokens` job a beépített `GITHUB_TOKEN`-t használja push-hoz (job-szintű `permissions: contents: write`). Ha a szervezetben alapból csak olvasási jogú `GITHUB_TOKEN`-t engedélyeznek, ellenőrizd a **Settings > Actions > General > Workflow permissions** beállítást, vagy engedélyezd explicit "Read and write permissions"-t.

### Futtatás GitHubon

1. Nyisd meg a **Actions** fület, válaszd a **Token Pipeline** workflow-t.
2. Kattints a **Run workflow** gombra a kívánt branch-en; opcionálisan add meg az `ids_styles_ref` inputot.
3. A `parse_tokens` job automatikusan lefut. A `validate_ids_styles_tokens` és `publish_tokens` jobok a hozzájuk rendelt Environment jóváhagyása után indulnak — ezt az Actions futtatás oldaláról, a **Review deployments** gombbal lehet engedélyezni.

Helyileg ugyanazok az `npm run parse`, `npm run validate:ids-styles` és `npm run publish` parancsok használhatók, mint a GitLab esetén — a két CI/CD platform között nincs eltérés a tényleges pipeline-logikában.


