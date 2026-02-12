//Funzione Haversine - Calcola la distanza in km tra due coordinate geografiche (solo per i cavi che non hanno l'informazione della lunghezza all'interno del file)
function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

//Funzione per controllare se un landing point è vicino al segmento
function isPointNearLine(pointCoords, lineCoords, thresholdKm = 5) {
    for (let i = 0; i < lineCoords.length; i++) {
        const dist = getDistance(pointCoords[1], pointCoords[0], lineCoords[i][1], lineCoords[i][0]);
        if (dist < thresholdKm) return true;
    }
    return false;
}

//Funzione per normalizzare e confrontare i nomi provenienti da fonti diverse(ci sono file diversi quindi formattazioni diverse)
function normalizeName(name) {
    if (!name) return "";
    return name.toLowerCase().replace(/[^a-z0-9]/g, "").trim();
}

//Funzione principale per il caricamento dei dati
export async function loadMapData() {

    const [cablesGeo, landingPointsGeo, csv3, csv1, all1, all2] = await Promise.all([ 
        fetch('./data/CableGeo.json').then(res => res.json()), //Carico tutti i file json e csv
        fetch('./data/LandingPointGeo.json').then(res => res.json()),
        fetch('./data/SubmarineCable3.csv').then(res => res.text()),
        fetch('./data/SubmarineCable1.csv').then(res => res.text()),
        fetch('./data/All1.json').then(res => res.json()),
        fetch('./data/All2.json').then(res => res.json())
    ]);

    const cableNameToAll1 = {}; //Mappa con nome normalizzato - Dati ufficiali all1.json
    if (Array.isArray(all1)) {
        all1.forEach(c => {
            const key = normalizeName(c?.name);
            if (key) cableNameToAll1[key] = c;
        });
    }

    const idToRealName = {}; //Mappa ID - Nome reale csv3
    const csv3Lines = csv3.split('\n');
    csv3Lines.slice(1).forEach(line => {
        const cols = line.split(',');
        if (cols.length > 1) {
            idToRealName[cols[0].trim()] = cols[1].trim();
        }
    });

    const nameToDetailsMap = {}; //Mappa con nome normalizzato - Dettagli csv1
    const csv1Lines = csv1.split('\n');
    csv1Lines.slice(1).forEach(line => {
        const cols = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
        if (cols.length > 5) {
            const cableName = cols[2].replace(/"/g, "").trim();
            nameToDetailsMap[normalizeName(cableName)] = {
                owner: cols[3].replace(/"/g, "").trim(),
                status: cols[4].replace(/"/g, "").trim()
            };
        }
    });

    //Arricchimento dei dati
    const enrichedCables = cablesGeo.features.map(feature => {

        const cableId = feature.properties.id;

        const realName = idToRealName[cableId] || feature.properties.name || "Cavo sconosciuto"; //Nome reale dal csv3

        const details = nameToDetailsMap[normalizeName(realName)] || {}; //Dettagli cavi

        const all1Details = cableNameToAll1[normalizeName(realName)] || cableNameToAll1[normalizeName(feature.properties.name)] || null; //Dati ufficiali json

        const geom = feature.geometry;

        //Individualizzazione dei landing point
        let connectedPoints = [];

        landingPointsGeo.features.forEach(lp => {

            const lpCoords = lp.geometry.coordinates;
            let near = false;

            if (geom.type === "LineString") {
                near = isPointNearLine(lpCoords, geom.coordinates);
            } else if (geom.type === "MultiLineString") {
                geom.coordinates.forEach(segment => {
                    if (isPointNearLine(lpCoords, segment)) near = true;
                });
            }

            if (near) connectedPoints.push(lp.properties.name);
        });

        const uniquePoints = [...new Set(connectedPoints)];

        //Calcolo della lunghezza stimata
        let totalLength = 0;

        if (geom.type === "MultiLineString") {
            geom.coordinates.forEach(line => {
                for (let i = 0; i < line.length - 1; i++) {
                    totalLength += getDistance(line[i][1], line[i][0], line[i+1][1], line[i+1][0]);
                }
            });
        } else {
            for (let i = 0; i < geom.coordinates.length - 1; i++) {
                totalLength += getDistance(geom.coordinates[i][1], geom.coordinates[i][0], geom.coordinates[i+1][1], geom.coordinates[i+1][0]);
            }
        }

        //Creazione oggetto finale
        return {
            ...feature,
            properties: {
                ...feature.properties,
                displayName: realName,
                owner: details.owner || null,
                status: details.status || "In attesa di dati",
                calculatedLength: totalLength > 0 ? Math.round(totalLength).toLocaleString() + " km" : null,
                connections: uniquePoints,

                // Dati ufficiali json
                officialLength: all1Details?.length || null,
                ownersOfficial: all1Details?.owners || null,
                rfs: all1Details?.rfs || null
            }
        };
    });

    return {
        cables: enrichedCables,
        landingPoints: landingPointsGeo.features
    };
}
