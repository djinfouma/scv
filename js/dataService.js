//Funzioni per la normalizzazione dei cavi: prendo i 3 file CSV diversi con colonne diverse e li trasformo in un formato unico in modo tale da poterli unire, duplicare, analizzare e mappare
//File 1: shortName, cableSystem, owner, status, region (nel file 1 non ci sono geometrie)
export function normalizeCable1(rows) {
  return rows.map(r => ({
    source: "SubmarineCable1",
    id: null,

    name: r.shortName ?? null,
    shortName: r.shortName ?? null,
    cableSystem: r.cableSystem ?? null,
    owner: r.owner ?? null,
    owners: r.owner ?? null,

    status: r.status ?? null,
    region: r.region ?? null,
    length: null,

    coordinates: null,   
  }));
}

//File 2: owner, cablesystem, region, SHAPE__Length, shortname, objectid, status (nel file 2 non ci sono geometrie)
export function normalizeCable2(rows) {
  return rows.map(r => ({
    source: "SubmarineCable2",
    id: r.objectid ?? null,

    name: r.shortname ?? null,
    shortName: r.shortname ?? null,
    cableSystem: r.cablesystem ?? r.cableSystem ?? null,
    owner: r.owner ?? null,
    owners: r.owner ?? null,

    status: r.status ?? null,
    region: r.region ?? null,
    length: r["SHAPE__Length"] ?? null,

    coordinates: null,   
  }));
}

//File 3: GeoJSON_Geometry contiene la geometria completa (MultiLineString), qui converto GeoJSON in array di punti
//File 3: id, name, owners, GeoJSON_Geometry, Geometry_Type...
export function normalizeCable3(rows) {
  return rows.map(r => {    
    const coords =
      coordsFromGeoJSON(r.GeoJSON_Geometry) ||
      coordsFromLooseString(r.coordinates); //fallback se GeoJSON non c'è
    return {
      source: "SubmarineCable3",
      id: r.id ?? null,

      name: r.name ?? null,
      shortName: r.name ?? null,
      owner: null,
      owners: r.owners ?? null,

      status: null,
      region: null,
      cableSystem: null,
      length: null,

      
      coordinates: coords, //punto più importante del file 3, perchè è la linea del cavo per la mappa
    };
  });
}


//Funzione per le coordinate, trasformo GeoJSON in una lista di punti
function coordsFromGeoJSON(value) {
  if (!value) return null;  
  if (typeof value === "object") return flattenGeoJSONCoords(value); //se è già un oggetto lo uso
  let s = String(value).trim();
  if (!s) return null;  
  s = s.replace(/""/g, '"'); //se arriva con doppi apici "" (da CSV)  
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1); //se fosse racchiuso tra virgolette esterne
  }
  try {
    const geo = JSON.parse(s);
    return flattenGeoJSONCoords(geo);
  } catch {
    return null;
  }
}

//Abbiamo due casi diversi LineString e MultiLineString
function flattenGeoJSONCoords(geo) {
  if (!geo || !geo.type || !geo.coordinates) return null;
  if (geo.type === "LineString") {
    return isCoordList(geo.coordinates) ? geo.coordinates : null; //In LineString le coordinate sono già sistemate(Le troviamo in questo modo: [[lon, lat], [lon, lat], ...])
  }
  if (geo.type === "MultiLineString") {
    const merged = geo.coordinates.flat();
    return isCoordList(merged) ? merged : null; //In MultiLineString le coordinate non vanno bene(Le troviamo in questo modo: [[[lon, lat],...], [[lon, lat],...]])e utilizzo flat per ottenere un'unica lista di punti
  }
  return null;
}

//Funzione di controllo
function isCoordList(coords) {
  return Array.isArray(coords) &&
    coords.length >= 2 &&
    coords.every(p =>
      Array.isArray(p) &&
      p.length >= 2 &&
      Number.isFinite(Number(p[0])) &&
      Number.isFinite(Number(p[1]))
    );
}

//Fallback: alcune coordinate sono "sparse" in un formato strano, quindi provo a estrarre coppie di numeri dalla stringa
function coordsFromLooseString(value) {
  if (!value) return null;
  const s = String(value);
  const matches = [...s.matchAll(/(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)/g)];
  if (matches.length < 2) return null;
  const coords = matches.map(m => [Number(m[1]), Number(m[2])]);
  return isCoordList(coords) ? coords : null;
}


//Funzione merge per unire i 3 array di cavi e togliere duplicati. Se hanno lo stesso nome (shortName/name) li considero lo stesso cavo. Se trovo duplicati tengo il primo e riempio i campi mancanti con secondo
export function mergeCables(c1, c2, c3) {
  const all = [...c1, ...c2, ...c3];  
  const map = new Map();
  for (const c of all) {
    const key =
      (c.shortName ? `n:${String(c.shortName).toLowerCase().trim()}` :
      (c.name ? `n:${String(c.name).toLowerCase().trim()}` :
      `id:${c.source}:${c.id}`));
    if (!map.has(key)) {
      map.set(key, c);
    } else {      
      const prev = map.get(key);
      map.set(key, { ...prev, ...fillMissing(prev, c) }); //perv è il cavo già salvato, c il nuovo cavo duplicato
    }
  }

  return Array.from(map.values());
}

function fillMissing(a, b) { //Riempio solo i campi m ancanti deel record principale usando i valori disponibili del duplicato
  const out = {};
  for (const k of Object.keys(b)) {
    if (a[k] == null && b[k] != null) out[k] = b[k];
  }
  return out;
}

//Funzione per normalizzare i punti di atterraggio. Trasformo PuntidiAtterraggio in un formato {id, name, lonj, lat}, in modo tale da poter fare nearest neighbor (landingA/landingB)
export function normalizeLandingPoints(rows) {
  return rows
    .map(r => {
      const id = r.ID_Punto ?? null;
      const name = r.Nome_Punto ?? null;
      const lon = toNum(r.Longitudine); //Longitutine-Latitudine devono diventare dei numeri e toNum gestisce anche il caso "sbagliato" (valori con numeri sbagliati e quindi tanti punti)
      const lat = toNum(r.Latitudine);
      return { id, name, lon, lat };
    })
    .filter(p =>
      Number.isFinite(p.lon) &&
      Number.isFinite(p.lat)
    );
}

//Funzione toNum converte il valore in un numero e gestisce anche i casi sbagliati
function toNum(v) {
  if (v == null) return null;
  let s = String(v).trim();
  if (!s) return null;
  if (/^[-+]?\d+(\.\d+)?$/.test(s)) return Number(s); //se il numero è giusto ok
  const sign = s.startsWith("-") ? "-" : ""; //se il numero è sbagliato(es. -6.497.531.918.865.530) memorizzo il segno
  s = s.replace(/[-+]/g, ""); //tolgo +/-
  s = s.replace(/[^\d]/g, ""); //tengo solo le cifre
  if (!s || s.length < 3) return null;
  const deg = s.slice(0, 2); //reiserisco il punto dopo 2 cifre
  const frac = s.slice(2);
  return Number(`${sign}${deg}.${frac}`);
}


//Funzione per il collegamento dei cavi. Per ogni cavo che ha coordinates: prende il primo punto della linea come “inizio”, prende l’ultimo punto della linea come “fine”, trova il landing point più vicino a ciascuno
export function attachNearestLandingPoints(cables, landingPoints) {
  return cables.map(cable => {

    let estimatedLengthKm = null;

    // Calcolo lunghezza reale lungo la geometria, se disponibile
    if (cable.coordinates && cable.coordinates.length >= 2) {
      estimatedLengthKm = computePathLengthKm(cable.coordinates);
    }

    if (!cable.coordinates || cable.coordinates.length < 2) {
      return {
        ...cable,
        landingA: null,
        landingB: null,
        estimatedLengthKm
      };
    }

    const start = cable.coordinates[0];
    const end = cable.coordinates[cable.coordinates.length - 1];

    const landingA = nearestPoint(start[0], start[1], landingPoints);
    const landingB = nearestPoint(end[0], end[1], landingPoints);

    return {
      ...cable,
      landingA,
      landingB,
      estimatedLengthKm
    };
  });
}



//Funzione per cercare il punto più vicino usando distanza Haversine
function nearestPoint(lon, lat, points) {
  let best = null;
  let bestD = Infinity;

  for (const p of points) {
    const d = haversineKm(lat, lon, p.lat, p.lon);
    if (d < bestD) {
      bestD = d;
      best = { ...p, distanceKm: Math.round(d * 10) / 10 }; // 1 decimale
    }
  }
  return best;
}

//Funzione per la distanza su sfera (km) con la formula standard
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = x => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

//Funzione che calcola la lunghezza stimata di un cavo sommando la distanza tra ogni coppia di punti consecutivi usando la formula Haversine
function computePathLengthKm(coordinates) {
  if (!coordinates || coordinates.length < 2) return null;

  let total = 0;

  for (let i = 0; i < coordinates.length - 1; i++) {
    const [lon1, lat1] = coordinates[i];
    const [lon2, lat2] = coordinates[i + 1];

    total += haversineKm(lat1, lon1, lat2, lon2);
  }

  return total;
}
