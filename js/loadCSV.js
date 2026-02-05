//Funzione principale: carica il file CSV via fetch e lo trasforma in array di oggetti  
export async function loadCSV(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Errore fetch ${path}: ${response.status}`);

  const text = await response.text(); //Scarico il file dal server, se la risposta non è ok fermo tutto altrimenti leggo il contenuto come testo  
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .filter(l => l.trim() !== ""); //Sistemo le righe: tolgo \r, split per \n e elimino le righe vuote 

  if (lines.length === 0) return []; //Se il file è vuoto o ci sono solo righe vuote ritorna un array vuoto  

  const delimiter = detectDelimiter(lines[0]); //Capisco se il file CSV è in tab \t, punto e virgola ; o virgola ,  
  
  const headers = parseCSVLine(lines[0], delimiter).map(h => h.replace(/^\uFEFF/, "").trim()); //Leggo l'header e lo trasformo in array di nomi colonna, gestisco i campi tra virgolette  

  const data = lines.slice(1).map(line => {
    const values = parseCSVLine(line, delimiter);
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = parseValue(values[i]);
    });
    return obj; //Per ogni riga successiva: la splitta in valori, costruisce un oggetto, parseValue prova a convertire numeri semplici e gestisce valori vuoti come null
  });

  return data;
}


//Funzione per il delimitatore
function detectDelimiter(headerLine) {
  if (headerLine.includes("\t")) return "\t";
  if (headerLine.includes(";")) return ";";
  return ",";
}

//Funzione parser base che supporta: delimitatore, campi tra virgolette anche se ci sono virgole e virgolette
function parseCSVLine(line, delimiter) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {      
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue; //Se siamo dentro virgolette e la prossima è " -> è escape quindi una " vera nel testo, salto la seconda " altrimenti esco entro dalla modalità dentro virgolette
    }
    if (ch === delimiter && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch; //Se trovo il separatore (delimitatore) e NON sono dentro virgolette allora chiudo il campo corrente e passo al successivo altrimenti aggiungo il carattere al campo corrente
  }
  out.push(cur);
  return out;
}


//Funzione per convertire ogni cella in un valore usabile, se manca il valore abbiamo null
function parseValue(value) {
  if (value === undefined) return null;
  const v = String(value).trim();
  if (v === "") return null;  
  const n = Number(v); //Non converto JSON automaticamente, lo lascio stringa e lo parseo dove serve tipo in GeoJSON_Geometry
  if (!Number.isNaN(n) && /^[-+]?\d+(\.\d+)?$/.test(v)) return n;
  return v;
}

