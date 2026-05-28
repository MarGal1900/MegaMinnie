# Salesforce koppelen voor live upload

MegaMinnie uploadt **ContentNote**, **Task** en **Event** naar een gekoppeld Account, Contact of Opportunity.

## Checklist

1. Connected App aanmaken in Salesforce
2. Integratiegebruiker + security token
3. `.env` invullen
4. Verbinding testen: `npm run sf:check`
5. Preview uitzetten: `MEGAMINNIE_DRY_RUN=false`
6. Optioneel: standaard record `SF_DEFAULT_WHAT_ID`

---

## Stap 1: Connected App

1. Log in als **admin** op [Salesforce Setup](https://login.salesforce.com)
2. Ga naar **Setup → App Manager → New Connected App**
3. Vul in:
   - **Connected App Name:** MegaMinnie
   - **API Name:** MegaMinnie
   - **Contact Email:** jouw e-mail
4. Onder **API (Enable OAuth Settings)**:
   - Vink **Enable OAuth Settings** aan
   - **Callback URL:** `http://localhost:3000/oauth/callback` (niet gebruikt, maar verplicht veld)
   - **Selected OAuth Scopes:** minimaal:
     - `Manage user data via APIs (api)`
     - `Perform requests at any time (refresh_token, offline_access)`
5. Sla op → wacht 2–10 minuten tot de app actief is
6. Open de app → **Manage Consumer Details**
7. Noteer **Consumer Key** → `SF_CLIENT_ID`
8. Noteer **Consumer Secret** → `SF_CLIENT_SECRET`

---

## Stap 2: Integratiegebruiker

Gebruik een dedicated API-gebruiker (niet je persoonlijke admin-account in productie).

1. Maak een gebruiker aan met profiel **Standard User** of **Sales User**
2. Geef rechten om ContentNotes, Tasks en Events aan te maken
3. Noteer **Username** → `SF_USERNAME`
4. Noteer **Password** → `SF_PASSWORD`

### Security token

1. Log in als die gebruiker
2. **Settings → My Personal Information → Reset My Security Token**
3. Token komt per e-mail → `SF_SECURITY_TOKEN`

> Bij sommige orgs is IP-whitelisting actief. Voeg dan je IP toe onder **Setup → Network Access**, of gebruik een VPN/fixed IP.

---

## Stap 3: `.env` invullen

```env
SF_LOGIN_URL=https://login.salesforce.com
# Sandbox: https://test.salesforce.com

SF_CLIENT_ID=3MVG9...          # Consumer Key
SF_CLIENT_SECRET=ABC123...     # Consumer Secret
SF_USERNAME=integratie@bedrijf.nl
SF_PASSWORD=GeheimWachtwoord
SF_SECURITY_TOKEN=AbCdEfGhIj

# Optioneel: auto-koppeling bij verwerking (Account/Contact/Opportunity Id)
# SF_DEFAULT_WHAT_ID=001xx000000000AAA
```

---

## Stap 4: Verbinding testen

```bash
npm run sf:check
```

Verwacht:

```
Salesforce-configuratie: compleet
Login: OK
Gebruiker: 005xx...
Org: 00Dxx...
Preview-modus: AAN — zet MEGAMINNIE_DRY_RUN=false voor live upload
```

Of via API:

```bash
curl http://127.0.0.1:3000/api/salesforce/status
```

---

## Stap 5: Live upload inschakelen

```env
MEGAMINNIE_DRY_RUN=false
```

Herstart MegaMinnie (`npm run dev`). De statusbadge toont dan geen "preview" meer.

---

## Workflow in de UI

1. Voer bezoeknotities in → MegaMinnie werkt uit
2. Controleer notitie, taken en agenda
3. **Koppel Salesforce-record** (automatisch voorstel of handmatig zoeken)
4. Klik **Upload naar Salesforce**

---

## Veelvoorkomende fouten

| Fout | Oplossing |
|------|-----------|
| `INVALID_LOGIN` | Username/wachtwoord/token controleren |
| `LOGIN_MUST_USE_SECURITY_TOKEN` | `SF_SECURITY_TOKEN` invullen |
| `invalid_client` | Client ID/secret controleren, wacht tot Connected App actief is |
| `API_DISABLED_FOR_ORG` | API inschakelen voor org/licentie |
| Preview-modus, niets geüpload | `MEGAMINNIE_DRY_RUN=false` |
| Zoeken levert niets op | Klantnaam handmatig zoeken; controleer rechten gebruiker |

---

## Sandbox vs productie

| Omgeving | `SF_LOGIN_URL` |
|----------|----------------|
| Productie | `https://login.salesforce.com` |
| Sandbox | `https://test.salesforce.com` |

Gebruik aparte Connected Apps en credentials per omgeving.
