//Funzione per calcolare la distanza in km tra due punti geografici (formula di Haversine)
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

//Funzione per verificare se un landing point è vicino a un segmento di cavo
function isPointNearLine(pointCoords, lineCoords, thresholdKm = 5) {
    for (let i = 0; i < lineCoords.length; i++) {
        const dist = getDistance(
            pointCoords[1], pointCoords[0], 
            lineCoords[i][1], lineCoords[i][0]
        );
        if (dist < thresholdKm) return true;
    }
    return false;
}

//Funzione per normalizzare un nome per il confronto (rimuove spazi, caratteri speciali, lowercase)
function normalizeName(name) {
    if (!name) return "";
    return name.toLowerCase().replace(/[^a-z0-9]/g, "").trim();
}

//Funzione per creare una mappa di lookup da array di oggetti o CSV
function createLookupMap(data, keyField, valueProcessor = (item) => item) {
    const map = {};
    
    if (Array.isArray(data)) {
        data.forEach(item => { //Caso JSON array
            const key = normalizeName(item[keyField]);
            if (key) map[key] = valueProcessor(item);
        });
    } else if (typeof data === 'string') {
        const lines = data.split('\n'); //Caso CSV (per SubmarineCable3.csv)
        lines.slice(1).forEach(line => {
            if (!line.trim()) return;
            const cols = line.split(',');
            if (cols.length > 1) {
                map[cols[0].trim()] = cols[1].trim(); //CSV3: colonna 0 = id, colonna 1 = nome
            }
        });
    }
    return map;
}

//Processa il CSV1 (SubmarineCable1.csv) per estrarre owner e status
function processCsv1Details(csvContent) {
    const map = {};
    if (!csvContent) return map;
    
    const lines = csvContent.split('\n');
    const regex = /,(?=(?:(?:[^"]*"){2})*[^"]*$)/; //Regex per gestire le virgole all'interno di campi quotati
    
    lines.slice(1).forEach(line => {
        if (!line.trim()) return;
        
        const cols = line.split(regex);
        
        if (cols.length > 2) { //Verifica che esista almeno il nome del cavo (colonna 2)
            const cableName = cols[2] ? cols[2].replace(/"/g, "").trim() : "";
            
            if (cableName) {
                map[normalizeName(cableName)] = {
                    owner: cols[3] ? cols[3].replace(/"/g, "").trim() : null,
                    status: cols[4] ? cols[4].replace(/"/g, "").trim() : "N/A"
                };
            }
        }
    });
    
    return map;
}

//Processa i dati dei cicloni dal CSV NOAA
function processCyclones(csvContent) {
    if (!csvContent) return [];
    
    const lines = csvContent.split('\n');
    
    return lines.slice(2) //Salta le prime due righe di intestazione
        .map(row => {
            if (!row.trim()) return null;
            const cols = row.split(',');
            if (cols.length < 11) return null;
            
            return {
                name: cols[5]?.trim(),
                basin: cols[3]?.trim(),
                lat: parseFloat(cols[8]),
                lon: parseFloat(cols[9]),
                wind: cols[10]?.trim()
            };
        })
        .filter(c => c && !isNaN(c.lat) && !isNaN(c.lon));
}

// Funzione per calcolare la lunghezza totale di una geometria (LineString o MultiLineString)
function calculateLength(geometry) {
    let totalLength = 0;
    
    const processLine = (line) => {
        for (let i = 0; i < line.length - 1; i++) {
            totalLength += getDistance(
                line[i][1], line[i][0],
                line[i+1][1], line[i+1][0]
            );
        }
    };
    
    if (geometry.type === "MultiLineString") {
        geometry.coordinates.forEach(processLine);
    } else if (geometry.type === "LineString") {
        processLine(geometry.coordinates);
    }
    
    return totalLength;
}

//Funzione per trovare i landing points connessi a un cavo
function findConnectedPoints(geometry, landingPointsFeatures, thresholdKm = 5) {
    const connectedPoints = [];
    
    landingPointsFeatures.forEach(lp => {
        const lpCoords = lp.geometry.coordinates;
        let near = false;
        
        const checkNear = (coords) => {
            if (isPointNearLine(lpCoords, coords, thresholdKm)) near = true;
        };
        
        if (geometry.type === "LineString") {
            checkNear(geometry.coordinates);
        } else if (geometry.type === "MultiLineString") {
            geometry.coordinates.forEach(checkNear);
        }
        
        if (near) connectedPoints.push(lp.properties.name);
    });
    
    return [...new Set(connectedPoints)]; //Rimuovi duplicati
}

//Funzione per verificare se un cavo è esposto a terremoti recenti
function checkEarthquakeExposure(geometry, earthquakesFeatures, thresholdKm = 100) {
    let exposed = false;
    let maxMag = 0;
    
    const checkEarthquake = (coord) => {
        if (exposed) return; //Early exit se già esposto
        
        earthquakesFeatures.forEach(eq => {
            const [eqLon, eqLat] = eq.geometry.coordinates;
            const dist = getDistance(coord[1], coord[0], eqLat, eqLon);
            
            if (dist < thresholdKm) {
                exposed = true;
                if (eq.properties.mag > maxMag) {
                    maxMag = eq.properties.mag;
                }
            }
        });
    };
    
    if (geometry.type === "LineString") {
        geometry.coordinates.forEach(checkEarthquake);
    } else if (geometry.type === "MultiLineString") {
        geometry.coordinates.forEach(segment => segment.forEach(checkEarthquake));
    }
    
    return { exposed, maxMag };
}

//Funzione per verificare se un cavo è esposto a cicloni attivi
function checkCycloneExposure(geometry, cyclones, thresholdKm = 250) {
    let exposed = false;
    let cycloneName = "";
    
    const checkCyclone = (coord) => {
        if (exposed) return; //Early exit se già esposto
        
        for (const cy of cyclones) {
            const dist = getDistance(coord[1], coord[0], cy.lat, cy.lon);
            if (dist < thresholdKm) {
                exposed = true;
                cycloneName = cy.name;
                break;
            }
        }
    };
    
    if (geometry.type === "LineString") {
        geometry.coordinates.forEach(checkCyclone);
    } else if (geometry.type === "MultiLineString") {
        geometry.coordinates.forEach(segment => segment.forEach(checkCyclone));
    }
    
    return { exposed, cycloneName };
}

//Funzione principale - Carica e arricchisce tutti i dati necessari per la mappa
export async function loadMapData() {
    const earthquakeUrl = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson";
    const cycloneUrl = "https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/v04r01/access/csv/ibtracs.ACTIVE.list.v04r01.csv";

    try {
        //Carica tutti i file in parallelo
        const [
            cablesGeo,
            landingPointsGeo,
            csv3,
            csv1,
            all1Data,
            all2,
            earthquakesGeo,
            cyclonesCSV
        ] = await Promise.allSettled([
            fetch('./data/CableGeo.json').then(res => res.json()),
            fetch('./data/LandingPointGeo.json').then(res => res.json()),
            fetch('./data/SubmarineCable3.csv').then(res => res.text()),
            fetch('./data/SubmarineCable1.csv').then(res => res.text()),
            fetch('./data/All1.json').then(res => res.json()),
            fetch('./data/All2.json').then(res => res.json()),
            fetch(earthquakeUrl).then(res => res.json()),
            fetch(cycloneUrl).then(res => res.text())
        ]);

        //Gestione errori con fallback a dati vuoti
        const resolvedCablesGeo = cablesGeo.status === 'fulfilled' ? cablesGeo.value : { features: [] };
        const resolvedLandingPoints = landingPointsGeo.status === 'fulfilled' ? landingPointsGeo.value : { features: [] };
        const resolvedCsv3 = csv3.status === 'fulfilled' ? csv3.value : '';
        const resolvedCsv1 = csv1.status === 'fulfilled' ? csv1.value : '';
        const resolvedAll1 = all1Data.status === 'fulfilled' && Array.isArray(all1Data.value) ? all1Data.value : [];
        const resolvedEarthquakes = earthquakesGeo.status === 'fulfilled' ? earthquakesGeo.value : { features: [] };
        const resolvedCyclonesCSV = cyclonesCSV.status === 'fulfilled' ? cyclonesCSV.value : '';

        //Processamento dati
        const idToRealName = createLookupMap(resolvedCsv3, '0');         // Mappa ID -> nome cavo
        const nameToDetailsMap = processCsv1Details(resolvedCsv1);      // Mappa nome -> owner/status
        const cyclones = processCyclones(resolvedCyclonesCSV);          // Array cicloni

        //Arricchimento dei cavi con tutte le informazioni aggiuntive
        const enrichedCables = resolvedCablesGeo.features.map(feature => {
            const cableId = feature.properties.id;
            const realName = idToRealName[cableId] || feature.properties.name || "Unknown Cable";
            const details = nameToDetailsMap[normalizeName(realName)] || {};
            
            //Cerca corrispondenza nei dati ufficiali All1.json
            const all1Details = resolvedAll1.find(d => {
                const nameMap = realName.toLowerCase().trim();
                const nameJson = d?.name?.toLowerCase().trim() || '';
                return nameJson.includes(nameMap) || nameMap.includes(nameJson);
            });

            const geometry = feature.geometry;
            
            //Calcola tutte le proprietà derivate
            const connectedPoints = findConnectedPoints(geometry, resolvedLandingPoints.features);
            const totalLength = calculateLength(geometry);
            const { exposed: exposedToEarthquake, maxMag: maxMagFound } = 
                checkEarthquakeExposure(geometry, resolvedEarthquakes.features);
            const { exposed: exposedToCyclone, cycloneName: riskCycloneName } = 
                checkCycloneExposure(geometry, cyclones);

            //Costruisce l'oggetto finale con tutte le proprietà
            return {
                ...feature,  
                properties: {
                    ...feature.properties,
                    displayName: realName,                 
                    owner: details.owner || null,          
                    status: details.status || "N/A",       
                    calculatedLength: totalLength > 0 
                        ? Math.round(totalLength).toLocaleString() + " km" 
                        : null,                             
                    connections: connectedPoints,          
                    exposedToCyclone: exposedToCyclone,    
                    cycloneName: riskCycloneName,          
                    officialLength: all1Details?.length || null,     
                    ownersOfficial: all1Details?.owners || null,     
                    rfs: all1Details?.rfs || null,                   
                    exposedToEarthquake: exposedToEarthquake,        
                    maxMag: maxMagFound > 0 ? maxMagFound : null     
                }
            };
        });

        return {
            cables: enrichedCables,
            landingPoints: resolvedLandingPoints.features,
            earthquakes: resolvedEarthquakes.features,
            cyclones: cyclones
        };

    } catch (error) {
        console.error("Errore fatale durante il caricamento dei dati:", error);
        return {
            cables: [],
            landingPoints: [],
            earthquakes: { features: [] },
            cyclones: []
        };
    }
}