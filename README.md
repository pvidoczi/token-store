# Token Store

Ez a repository a Figma token-export és a frontend projekt közötti átadó pipeline. A branch szándékosan nem tartalmaz exportált JSON- vagy generált CSS-fájlokat.

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

Üres bemenettel a parser sikeresen leáll és nem készít CSS-t. A Figma JSON-ok később commitolhatók. A `foundations/**` vagy `components/**` alatti push automatikusan elindítja a GitLab parse jobot. A teljes pipeline a GitLab **Build > Pipelines > New pipeline** felületéről manuálisan is indítható. Beérkező tokenek esetén az `ids_css` könyvtárba generálja a fájlokat, artifactként eltárolja, majd `[skip ci]` commitban visszapusholja az aktuális branchre.

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

A `validate_ids_styles_tokens` job kizárólag a GitLab felületéről indított (`web`) pipeline-ban jelenik meg, és ott is manuálisan kell elindítani. Nem függ a `parse_tokens` jobtól vagy annak artifactjától: a meglévő parserrel saját maga generálja le az ellenőrzéshez szükséges CSS-t, de nem futtat commit- vagy publish scriptet. Ezután a generált CSS-változókat hasonlítja össze az `ids-styles` lefordított CSS-ében található `var(--...)` hivatkozásokkal. A job az `ids-styles` saját buildjét futtatja, ezért a Sass ciklusok és interpolációk már feloldott CSS-ként kerülnek az ellenőrzésbe.

A GitLab projekt **Settings > CI/CD > Variables** részében kötelező beállítani az `IDS_STYLES_REF` változót egy branchre, tagre vagy commit SHA-ra, például `main`, egy release tag vagy egy teljes commit SHA. A job hibával leáll, ha az `ids-styles` olyan tokent hivatkozik, amelyet a generált CSS nem definiál. A nem közvetlenül hivatkozott generált tokenek csak információk; nem feltétlenül használatlanok, mert komponens tokenek foundation tokenekre támaszkodhatnak. A teljes eredmény a mindig megőrzött `token-diff-report.json` artifactban is elérhető.
