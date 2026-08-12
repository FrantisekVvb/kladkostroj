# Kladkostroj

Dvě kladky na bílém pozadí — **červená pevná** a **modrá volná**.

## Spuštění online

**[Otevřít simulaci](https://frantisekvvb.github.io/kladkostroj/)**

Po pushi na `main` se stránka nasadí automaticky (větev `gh-pages`). První nasazení může trvat 1–2 minuty.

**Jednorázové nastavení v GitHubu** (pokud odkaz nefunguje):

1. Repozitář → **Settings** → **Pages**
2. U *Build and deployment* zvol **Deploy from a branch**
3. Branch: **gh-pages** / **/(root)**
4. Ulož a počkej cca minutu

## Spuštění lokálně

```bash
cd kladkostroj
npm start
```

Otevři **http://localhost:3480**. Při úpravách souborů se stránka sama obnoví.

## Ovládání

- **Lano** (přepínač) — aktivní: kreslení lana; neaktivní: přesouvání kladek a závaží
- **Spustit** — spustí / zastaví simulaci
- **Smazat lano** — guma smaže lana a objekty
