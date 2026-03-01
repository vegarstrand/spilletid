# ⚽ Bytteplanlegger

Hjelper fotballtrenere med å sikre lik spilletid for alle spillere gjennom automatiske og manuelle bytter.

## Kjør lokalt

```bash
npm install
npm run dev
```

Åpne http://localhost:5173 i nettleseren.

## Deploy gratis

### Alternativ 1: Vercel (anbefalt — enklest)

1. Opprett konto på [vercel.com](https://vercel.com)
2. Installer Vercel CLI: `npm i -g vercel`
3. Kjør i prosjektmappen:
   ```bash
   npm install
   vercel
   ```
4. Følg instruksjonene — ferdig! Du får en URL som `bytteplanlegger.vercel.app`

Eller: push prosjektet til GitHub og koble repoet direkte i Vercel-dashboardet.

### Alternativ 2: Netlify

1. Opprett konto på [netlify.com](https://netlify.com)
2. Bygg prosjektet:
   ```bash
   npm install
   npm run build
   ```
3. Dra `dist`-mappen inn i Netlify-dashboardet, eller bruk CLI:
   ```bash
   npm i -g netlify-cli
   netlify deploy --prod --dir=dist
   ```

### Alternativ 3: GitHub Pages

1. Push til GitHub
2. Legg til i `vite.config.js`: `base: '/repo-navn/'`
3. Kjør: `npm run build`
4. Deploy `dist`-mappen via GitHub Pages-innstillingene

## Legg til på hjemskjerm (iOS/Android)

Appen fungerer som en "web-app" på mobil. Åpne URL-en i Safari/Chrome, trykk del-knappen, og velg **Legg til på Hjem-skjerm**. Da kjører den i fullskjerm uten adressefelt.
