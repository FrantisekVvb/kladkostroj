# Kladkostroj

Dvě kladky na bílém pozadí — **červená pevná** a **modrá volná**.

## Spuštění online

**[Otevřít simulaci](https://frantisekvvb.github.io/kladkostroj/)**

Po pushi na `main` se stránka nasadí automaticky přes GitHub Actions. První nasazení může trvat 1–2 minuty.

**Jednorázové nastavení v GitHubu** (pokud odkaz vrací 404):

1. Otevři [Settings → Pages](https://github.com/FrantisekVvb/kladkostroj/settings/pages)
2. U *Build and deployment* → *Source* zvol **GitHub Actions**
3. Po dalším pushi na `main` (nebo ručním spuštění workflow *Deploy to GitHub Pages*) bude stránka dostupná

Alternativa: *Deploy from a branch* → větev **gh-pages** → složka **/(root)**.

## Spuštění lokálně

```bash
cd kladkostroj
npm start
```

Otevři **http://localhost:3480**. Při úpravách souborů se stránka sama obnoví.

## Ovládání

- **Lano** (přepínač) — aktivní: kreslení lana; neaktivní: přesouvání kladek a závaží
- **Spustit / Editor** — přepínač: spustí simulaci, nebo se vrátí do editoru
- **Smazat lano** — guma smaže lana a objekty
