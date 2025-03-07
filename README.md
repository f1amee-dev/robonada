# 🤖 Robonada Discord Bot

## 📋 Sadržaj
- [Uvod](#uvod)
- [Instalacija](#instalacija)
- [Konfiguracija](#konfiguracija)
- [Pokretanje bota](#pokretanje-bota)
- [Naredbe](#naredbe)
- [Rješavanje problema](#rješavanje-problema)

## 🌟 Uvod

**Robonada** je Discord bot dizajniran za upravljanje anketama i praćenje prisutnosti na robotici. Bot automatski stvara ankete prema konfiguriranom rasporedu i bilježi tko je prisutan na robotici.


## 🔧 Instalacija

### Preduvjeti
- [Node.js](https://nodejs.org/) (verzija 16.9.0 ili novija)
- [npm](https://www.npmjs.com/) (dolazi s Node.js)
- [Git](https://git-scm.com/) (opcionalno)

### Koraci instalacije

1. **Klonirajte repozitorij** (ili preuzmite ZIP datoteku)
   ```bash
   git clone https://github.com/f1amee-dev/robonada.git
   cd robonada
   ```

2. **Instalirajte potrebne pakete**
   ```bash
   npm install
   ```

## ⚙️ Konfiguracija

### Stvaranje Discord aplikacije

1. Posjetite [Discord Developer Portal](https://discord.com/developers/applications)
2. Kliknite na "**New Application**" i unesite ime za svog bota
3. Idite na karticu "**Bot**" i kliknite "**Add Bot**"
4. Pod "**Privileged Gateway Intents**", omogućite:
   - `PRESENCE INTENT`
   - `SERVER MEMBERS INTENT`
   - `MESSAGE CONTENT INTENT`
5. Kliknite na "**Reset Token**" i kopirajte token (trebat će vam za `config.json`)
6. Idite na karticu "**OAuth2**" > "**URL Generator**"
7. Odaberite opsege: `bot` i `applications.commands`
8. Za dozvole bota odaberite:
   - `Send Messages`
   - `Embed Links`
   - `Read Message History`
   - `Use Slash Commands`
9. Kopirajte generirani URL i otvorite ga u pregledniku da pozovete bota na svoj server

### Stvaranje `config.json` datoteke

Napravite datoteku `config.json` u glavnom direktoriju projekta sa sljedećim sadržajem:

```json
{
  "token": "TVOJ_BOT_TOKEN",
  "clientId": "ID_TVOJE_APLIKACIJE",
  "guildId": "ID_TVOG_DISCORD_SERVERA",
  "encryptionKey": "TVOJ_ENCRYPTION_KEY",
  "storageChannelId": "MJENJA_SE"
}
```

*Zamijenite:*
- `TVOJ_BOT_TOKEN` s tokenom koji ste kopirali iz Discord Developer Portala
- `ID_TVOJE_APLIKACIJE` s ID-om vaše aplikacije (možete ga pronaći na kartici "General Information")
- `ID_TVOG_DISCORD_SERVERA` s ID-om vašeg Discord servera (desni klik na server > "Copy ID")

### Konfiguracija anketa 

Možete stvoriti datoteku `pollConfig.json` u glavnom direktoriju za prilagodbu postavki anketa:

```json
{
  "pollChannelId": "ID_KANALA_ZA_ANKETE",
  "pollDay": 4,
  "pollTime": "16:00",
  "mentionRoles": ["ID_ULOGE1", "ID_ULOGE2"]
}
```

*Napomene:*
- `pollDay`: 0 = nedjelja, 1 = ponedjeljak, ..., 6 = subota
- `pollTime`: format "HH:MM" u 24-satnom formatu
- `mentionRoles`: lista ID-ova uloga koje će bot spomenuti prilikom stvaranja ankete

## 🚀 Pokretanje bota

### Registracija naredbi

Prije prvog pokretanja bota, morate registrirati slash naredbe:

```bash
node deploy-commands.js
```

*Trebali biste vidjeti poruku: "uspješno ponovno učitano X aplikacijskih (/) naredbi."*

### Pokretanje bota

```bash
node bot.js
```

*Bot bi trebao ispisati "[info] prijavljen kao ImeVašegBota#0000" kada se uspješno pokrene.*

### Postavljanje bota da radi u pozadini (opcionalno)

Za produkcijsko okruženje, preporučujemo korištenje upravitelja procesa poput [PM2](https://pm2.keymetrics.io/):

```bash
# Instalacija PM2
npm install -g pm2

# Pokretanje bota s PM2
pm2 start bot.js --name "robonada"

# Postavljanje automatskog pokretanja nakon restarta sustava
pm2 startup
pm2 save
```

## 🔍 Naredbe

Bot podržava sljedeće slash naredbe:

| Naredba | Opis |
|---------|------|
| `/anketa info` | Prikazuje informacije o automatskim anketama |
| `/anketa test` | Stvara test anketu u trenutnom kanalu (traje 1 minutu) |
| `/anketa end` | Završava aktivnu anketu u trenutnom kanalu |

## ❓ Rješavanje problema

### Brisanje naredbi

Ako trebate izbrisati sve registrirane naredbe (npr. tijekom razvoja):

```bash
node delete-commands.js
```

### Česti problemi

1. **Bot se ne povezuje**
   - Provjerite je li token ispravan u `config.json`
   - Provjerite jesu li omogućeni potrebni intenti

2. **Naredbe se ne prikazuju**
   - Pokrenite `node deploy-commands.js` ponovno
   - Provjerite jesu li `clientId` i `guildId` ispravni u `config.json`
   - Pričekajte do sat vremena da Discord ažurira svoje predmemorije

3. **Ankete se ne stvaraju automatski**
   - Provjerite je li `pollChannelId` ispravan u `pollConfig.json`
   - Provjerite jesu li `pollDay` i `pollTime` ispravno postavljeni

---

<p align="center">
  <i>Napravljeno s ❤️</i>
</p>

<p align="center">
  <b>Za dodatnu pomoć kontaktirajte filipa ( discord.gg/robonada )</b>
</p> 
