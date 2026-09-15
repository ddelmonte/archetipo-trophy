# Archetipo Trophy 🏈🏆

Sito statico con lo storico della lega fantasy NFL **Archetipo Trophy** su Sleeper:
bacheca dei trofei, statistiche delle squadre e scontri diretti.

## Da dove arrivano i dati

- **2020–2021** (prima di Sleeper): `data/pre-sleeper.json`, dal Foglio Google della lega. Contiene solo la bacheca.
- **Dal 2022**: API pubblica di Sleeper.
  - Le stagioni concluse sono salvate in `data/sleeper/` con `node tools/snapshot.js`.
  - La stagione in corso viene letta dal vivo al caricamento della pagina.
  - Quando esiste una nuova lega collegata a quella del 2026, il sito la trova da solo.

Record e punti vengono dalla classifica ufficiale di Sleeper. I punteggi partita per partita
sono ricalcolati da Sleeper con le correzioni statistiche successive: se l'esito di una
partita non torna con la classifica ufficiale, viene riallineato (vedi `sleeper.js`).

## Regole dei trofei

- **Lorenzo Selmi Trophy**: vincitore del Super Bowl (finale del tabellone play off).
- **Archetipo Trophy**: più punti fatti in regular season.
- **Conference champion**: primo di ogni division in regular season (a pari record vale chi ha più punti fatti).
- **MVP di giornata**: squadra con il punteggio più alto della giornata di regular season.

## A fine stagione

```bash
node tools/snapshot.js
```

Poi fai commit e push della cartella `data/sleeper/`.

## Anteprima in locale

Serve un piccolo server statico, perché la pagina carica i file JSON. Per esempio:

```bash
npx serve .
```
