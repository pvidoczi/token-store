# Token Store

Ez a repository a Figma token-export és a frontend projekt közötti átadó pipeline. A branch szándékosan nem tartalmaz exportált JSON- vagy generált CSS-fájlokat.

## Könyvtárstruktúra

A Figma exportot a `figma-export` könyvtárba kell másolni:

```text
figma-export/
├── foundation/
│   ├── base/base.json
│   ├── smc-colors/{dark,light}.json
│   ├── smc-layout/{small,medium,large,xlarge}.json
│   └── smc-reference/smc-reference.json
└── components/
    └── <komponens>/{comp-color,comp-size}/*.json
```

Üres bemenettel a parser sikeresen leáll és nem készít CSS-t. A Figma JSON-ok később commitolhatók, így a push elindítja a workflow-t. Beérkező tokenek esetén az `ids_css` könyvtárba generálja a fájlokat; ez a kimeneti könyvtár nincs verziókezelve.

## Helyi használat

```bash
npm ci
npm run parse
```

Az útvonalak felülírhatók a `FIGMA_INPUT_DIR` és `CSS_OUTPUT_DIR` környezeti változókkal.

## Továbbítás GitLab repóba

A `npm run publish` generálja a CSS-t, klónozza a célrepót, lecseréli a cél CSS-könyvtár tartalmát, és csak tényleges változás esetén commitol és pushol.

Kötelező konfiguráció:

- `TARGET_REPO_URL`: hitelesített GitLab clone URL (CI-ben secretként tárolandó).

Opcionális konfiguráció:

- `TARGET_REPO_BRANCH` (alapérték: `main`)
- `TARGET_CSS_PATH` (alapérték: `src/assets/ids_css`)
- `TARGET_CHECKOUT_DIR` (alapérték: `target-repo`)
- `TARGET_COMMIT_MESSAGE`
- `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`

A workflow-höz a repository secretként `TARGET_REPO_URL`, változóként pedig igény szerint `TARGET_REPO_BRANCH` és `TARGET_CSS_PATH` állítandó be. A secret URL lehet például HTTPS deploy-tokenes GitLab URL; valódi tokent nem szabad a repositoryba commitolni.
