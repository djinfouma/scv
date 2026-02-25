import { loadMapData } from "./dataService.js";

// Inizializzazione mappa
const map = L.map("map", {
  worldCopyJump: true,        
  minZoom: 2,                 
  maxBoundsViscosity: 1.0     
}).setView([20, 0], 2);       

// Layer base OpenStreetMap
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

// Variabili globali per tracciare i layer
let selectedLayer = null;      // Cavo attualmente selezionato
let allCableLayers = [];       // Tutti i layer dei cavi
let allPointLayers = [];       // Tutti i layer dei landing point

//Funzione per gestisce i confini per cavi che attraversano l'antimeridiano (180°)
function getCorrectBounds(layer) {
    const bounds = layer.getBounds();
    const west = bounds.getWest();
    const east = bounds.getEast();
    
    //Se la differenza è > 180°, il cavo attraversa l'antimeridiano
    if (Math.abs(east - west) > 180) {
        return { center: bounds.getCenter(), isWide: true };
    }
    return { bounds: bounds, isWide: false };
}

//Funzione per resettare la mappa allo stato iniziale
function resetMap() {
    document.getElementById("searchInput").value = ""; //Pulisce la barra di ricerca
    
    const yearSlider = document.getElementById("yearSlider");
    const selectedYear = parseInt(yearSlider.value);
    const isDefault = selectedYear === 2027; // 2027 = "mostra tutto"

    allCableLayers.forEach(layer => { //Resetta tutti i cavi
        const p = layer.feature.properties;
        let cableYear = 0;
        
        if (p.rfs) {
            const match = p.rfs.match(/\d{4}/);
            if (match) cableYear = parseInt(match[0]);
        }

        if (isDefault || (cableYear > 0 && cableYear <= selectedYear)) { //Mostra se siamo al 2027 OPPURE il cavo ha data <= anno selezionato
            layer.setStyle({ 
                weight: 2, 
                opacity: 1, 
                color: p.color || "#ff3333",
                interactive: true 
            });
        } else {
            layer.setStyle({ opacity: 0, interactive: false });
        }
    });

    allPointLayers.forEach(lp => { //Resetta tutti i landing point
        const pointName = lp.feature.properties.name;
        
        const hasVisibleCable = allCableLayers.some(cl => { //Verifica se esiste almeno un cavo visibile connesso a questo punto
            const cp = cl.feature.properties;
            const cy = cp.rfs ? cp.rfs.match(/\d{4}/) : null;
            const year = cy ? parseInt(cy[0]) : 0;
            return isDefault || (year > 0 && year <= selectedYear && cp.connections.includes(pointName));
        });

        if (hasVisibleCable) {
            lp.setStyle({ radius: 3, fillOpacity: 1, opacity: 1 });
        } else {
            lp.setStyle({ opacity: 0, fillOpacity: 0 });
        }
    });
}

//Funzione per aggiornare la lista dei cavi a rischio terremoti
function updateEarthquakeRiskList(riskList, cables, allCableLayers, map, resetMap, getCorrectBounds) {
    riskList.innerHTML = "";
    const exposedCables = cables.filter(c => c.properties.exposedToEarthquake);

    if (exposedCables.length > 0) {
        exposedCables.forEach(c => {
            const li = document.createElement("li");
            li.innerHTML = `<span>${c.properties.displayName}</span> <b style="color:#b30000; float:right;">Mag: ${c.properties.maxMag || 'N/A'}</b>`;

            li.onclick = () => { //Click su un elemento della lista -> zoom sul cavo
                const targets = allCableLayers.filter(l => l.feature.properties.displayName === c.properties.displayName);

                if (targets.length > 0) {
                    resetMap();

                    allCableLayers.forEach(l => { //Opacizza tutti i cavi tranne il target
                        if (l.setStyle) l.setStyle({ opacity: 0.05 });
                    });

                    targets.forEach(t => { //Evidenzia il cavo target
                        t.setStyle({
                            color: '#FFA500',  
                            weight: 6,
                            opacity: 1,
                            interactive: true
                        });
                        t.bringToFront();
                    });

                    const boundInfo = getCorrectBounds(targets[0]); //Centra la mappa sul cavo

                    if (boundInfo.isWide) {
                        map.setView(boundInfo.center, 3);
                    } else {
                        map.fitBounds(boundInfo.bounds, { padding: [50, 50] });
                    }
                    targets[0].openPopup(); //Apre il popup
                }
            };

            riskList.appendChild(li);
        });
    } else {
        riskList.innerHTML = "<li>No cables currently at risk</li>";
    }
}

//Funzione per aggiornare la lista dei cavi a rischio cicloni
function updateCycloneRiskList(riskList, cables, allCableLayers, map, resetMap, getCorrectBounds) {
    riskList.innerHTML = "";
    const exposedCables = cables.filter(c => c.properties.exposedToCyclone);

    if (exposedCables.length > 0) {
        exposedCables.forEach(c => {
            const li = document.createElement("li");
            li.innerHTML = `<span>${c.properties.displayName}</span> <b style="color:#2e86c1; float:right;">Storm: ${c.properties.cycloneName || 'N/A'}</b>`;

            
            li.onclick = () => { //Click su un elemento della lista -> zoom sul cavo
                const targets = allCableLayers.filter(l => l.feature.properties.displayName === c.properties.displayName);

                if (targets.length > 0) {
                    resetMap();
                    
                    allCableLayers.forEach(l => { //Opacizza tutti i cavi tranne il target
                        if (l.setStyle) l.setStyle({ opacity: 0.05 });
                    });

                    targets.forEach(t => { //Evidenzia il cavo target
                        t.setStyle({
                            color: '#2e86c1',  // Blu
                            weight: 6,
                            opacity: 1,
                            interactive: true
                        });
                        t.bringToFront();
                    });

                    const boundInfo = getCorrectBounds(targets[0]); //Centra la mappa sul cavo

                    if (boundInfo.isWide) {
                        map.setView(boundInfo.center, 3);
                    } else {
                        map.fitBounds(boundInfo.bounds, { padding: [50, 50] });
                    }
                    targets[0].openPopup(); //Apre il popup
                }
            };

            riskList.appendChild(li);
        });
    } else {
        riskList.innerHTML = "<li>No cables currently at risk</li>";
    }
}

//Funzione principale
async function init() {
    
    const { cables, landingPoints, earthquakes, cyclones } = await loadMapData(); //Carica tutti i dati

    //Gestione dei cicloni
    const cycloneLayer = L.layerGroup();
    const cycloneSidebar = document.getElementById("cyclone-sidebar");
    const cycloneRiskList = document.getElementById("cyclone-risk-list");
    let cycloneVisible = false; //Stato visibilità cicloni

    //Crea marker per ogni ciclone
    cyclones.forEach(cy => {
        const marker = L.circleMarker([cy.lat, cy.lon], {
            radius: 10,
            color: '#00f2fe',
            fillColor: '#00c6ff',
            fillOpacity: 0.7,
            weight: 2
        }).bindPopup(`<b>Storm: ${cy.name}</b><br>Basin: ${cy.basin}<br>Max Wind: ${cy.wind} kts`);
        
        cycloneLayer.addLayer(marker);
    });

    //Gestione toggle cicloni
    const cyToggle = document.getElementById("cycloneToggle");
    cyToggle.addEventListener("click", () => {
        cycloneVisible = !cycloneVisible;

        if (cycloneVisible) {
            cycloneLayer.addTo(map);
            cyToggle.style.background = "#2e86c1";//Mostra cicloni
            cyToggle.innerText = "Hide Cyclones";

            updateCycloneRiskList(cycloneRiskList, cables, allCableLayers, map, resetMap, getCorrectBounds); //Aggiorna lista cavi a rischio

            cycloneSidebar.style.display = "flex"; //Mostra sidebar
            map.invalidateSize();

        } else {
            map.removeLayer(cycloneLayer); //Nascondi cicloni
            cyToggle.style.background = "#0D3B66";
            cyToggle.innerText = "Show Cyclones (Active)";

            cycloneSidebar.style.display = "none"; //Nascondi sidebar
            resetMap(); //Ripristina colori originali
            setTimeout(() => map.invalidateSize(), 100);
        }
    });

    //Funzione per aggiungere layer GeoJSON
    function addGeoJSONLayer(data, offset, isPoint = false) {
        return L.geoJSON(data, {
            coordsToLatLng: (coords) => L.latLng(coords[1], coords[0] + offset), //Gestione coordinate con offset per duplicazione mondo

            style: (feature) => ({ //Stile per le linee (cavi)
                color: feature.properties.color || "#ff3333",
                weight: 2,
                opacity: 1,
                fillOpacity: 1
            }),

            pointToLayer: (feature, latlng) => { //Stile per i punti (landing point)
                if (isPoint) {
                    return L.circleMarker(latlng, {
                        radius: 3,
                        fillColor: "#0D3B66",
                        fillOpacity: 1,
                        stroke: false,
                        interactive: true
                    });
                }
            },
            
            onEachFeature: (feature, layer) => { //Gestione interattività per ogni feature
                const p = feature.properties;

                if (!isPoint) {
                    allCableLayers.push(layer); //Salva per riferimenti futuri

                    //Tooltip con nome (appare al passaggio del mouse)
                    layer.bindTooltip(`<b>${p.displayName}</b>`, {
                        sticky: true,
                        direction: "auto",
                        opacity: 0.9
                    });

                    //Prepara dati per il popup
                    const lengthToShow = p.officialLength && p.officialLength !== "n.a."
                        ? p.officialLength
                        : p.calculatedLength || "N/D";

                    const ownerRaw = p.ownersOfficial && p.ownersOfficial !== "n.a."
                        ? p.ownersOfficial
                        : p.owner || "N/A";

                    const formattedOwners = ownerRaw.includes(",")
                        ? ownerRaw.split(",").map((o) => o.trim()).join("<br>")
                        : ownerRaw;

                    const listItems = p.connections.length > 0
                        ? p.connections.map((name) => `<li>${name}</li>`).join("")
                        : "<li>N/A</li>";

                    //Contenuto HTML del popup
                    const popupContent = `
                        <div style="font-family:'Segoe UI', Tahoma, sans-serif; min-width:260px;">
                            <h3 style="
                                margin:0 0 10px 0;
                                color:${p.color};
                                border-bottom:2px solid ${p.color};
                                padding-bottom:5px;">
                                ${p.displayName}
                            </h3>

                            <table style="width:100%; font-size:12px; border-collapse:collapse; margin-bottom:10px;">
                                <tr>
                                    <td style="color:#666;"><b>Length:</b></td>
                                    <td>${lengthToShow}</td>
                                </tr>
                                <tr>
                                    <td style="color:#666;"><b>Status:</b></td>
                                    <td>${p.status}</td>
                                </tr>
                                <tr>
                                    <td style="color:#666; vertical-align:top;"><b>Owners:</b></td>
                                    <td style="line-height:1.4;">${formattedOwners}</td>
                                </tr>
                                ${p.rfs ? `
                                <tr>
                                    <td style="color:#666;"><b>Ready for Service Date:</b></td>
                                    <td>${p.rfs}</td>
                                </tr>` : ""}
                            </table>

                            <div style="
                                background:#f9f9f9;
                                padding:10px;
                                border-radius:6px;
                                border:1px solid #eee;
                            ">
                                <b style="
                                    font-size:10px;
                                    text-transform:uppercase;
                                    display:block;
                                    margin-bottom:6px;">
                                    Landing Points
                                </b>

                                <ul style="
                                    margin:0;
                                    padding-left:14px;
                                    font-size:11px;
                                    max-height:140px;
                                    overflow-y:auto;
                                ">
                                    ${listItems}
                                </ul>
                            </div>
                        </div>
                    `;

                    layer.bindPopup(popupContent);

                    //Logica sezione cavo
                    layer.on("click", function (e) {
                        map.eachLayer((l) => { //Opacizza tutti i cavi
                            if (l.feature && l.setStyle) {
                                if (l.feature.geometry.type !== "Point") {
                                    l.setStyle({ opacity: 0.1 });
                                }
                            }
                        });

                        this.setStyle({ //Evidenzia cavo selezionato
                            opacity: 1,
                            weight: 5
                        });

                        map.eachLayer((l) => { //Evidenzia i landing point collegati
                            if (l.feature && l.feature.geometry.type === "Point") {
                                if (p.connections.includes(l.feature.properties.name)) {
                                    l.setStyle({
                                        radius: 6,
                                        fillColor: p.color,
                                        fillOpacity: 1
                                    });
                                } else {
                                    l.setStyle({ fillOpacity: 0.1 });
                                }
                            }
                        });

                        selectedLayer = this;
                        L.DomEvent.stopPropagation(e);
                    });
                    
                    layer.on("mouseover", function () {
                        if (!selectedLayer) this.setStyle({ weight: 4 });
                    });

                    layer.on("mouseout", function () {
                        if (!selectedLayer) this.setStyle({ weight: 2 });
                    });

                } else {
                    allPointLayers.push(layer);
                    layer.bindTooltip(p.name);
                }
            }
        }).addTo(map);
    }

    //Click sulla mappa (non su un cavo) -> resetta tutto
    map.on("click", () => {
        resetMap();
        selectedLayer = null;
    });

    //Duplicazione mondo per gestione antimeridiano
    [-360, 0, 360].forEach((offset) => {
        addGeoJSONLayer(cables, offset);           // Aggiunge cavi
        addGeoJSONLayer(landingPoints, offset, true); // Aggiunge landing points
    });

    //Gestione terremoti
    const earthquakeLayerGroup = L.layerGroup();

    //Funzione per creare un layer per i terremoti con un dato offset
    function createEarthquakeLayer(offset) {
        return L.geoJSON(earthquakes, {
            coordsToLatLng: (coords) => L.latLng(coords[1], coords[0] + offset),

            pointToLayer: (feature, latlng) => {
                const magnitude = feature.properties.mag;
                const radiusSize = Math.pow(magnitude, 2) * 0.8; //Dimensione proporzionale al quadrato della magnitudo

                return L.circleMarker(latlng, {
                    radius: radiusSize,
                    fillColor: "#ff4d4d",
                    color: "#b30000",
                    weight: 1,
                    fillOpacity: 0.7
                });
            },

            onEachFeature: function (feature, layer) {
                const p = feature.properties;
                layer.bindPopup(`
                    <div style="font-family: sans-serif;">
                        <strong style="color: #b30000;">EARTHQUAKE</strong><br>
                        <strong>Magnitude:</strong> ${p.mag}<br>
                        <strong>Location:</strong> ${p.place}<br>
                        <strong>Depth:</strong> ${feature.geometry.coordinates[2]} km
                    </div>
                `);
            }
        });
    }

    //Crea tre copie dei terremoti (per gestione antimeridiano)
    [-360, 0, 360].forEach(offset => {
        createEarthquakeLayer(offset).addTo(earthquakeLayerGroup);
    });

    //Gestione toggle terremoti
    const eqToggle = document.getElementById("earthquakeToggle");
    const earthquakeSidebar = document.getElementById("earthquake-sidebar");
    const earthquakeRiskList = document.getElementById("earthquake-risk-list");
    let eqVisible = false;

    eqToggle.addEventListener("click", () => {
        eqVisible = !eqVisible;

        if (eqVisible) {
            
            earthquakeLayerGroup.addTo(map); //Mostra terremoti
            eqToggle.innerText = "Hide Earthquakes";
            eqToggle.style.background = "#ff4d4d";

            updateEarthquakeRiskList(earthquakeRiskList, cables, allCableLayers, map, resetMap, getCorrectBounds); //Aggiorna lista cavi a rischio

            earthquakeSidebar.style.display = "flex";//Mostra sidebar
            map.invalidateSize();

        } else {
            
            if (map.hasLayer(earthquakeLayerGroup)) { //Nascondi terremoti
                map.removeLayer(earthquakeLayerGroup);
            }

            eqToggle.innerText = "Show Earthquakes (Real-time)";
            eqToggle.style.background = "#0D3B66";

            earthquakeSidebar.style.display = "none"; //Nascondi sidebar
            resetMap(); //Ripristina colori originali
            setTimeout(() => map.invalidateSize(), 100);
        }
    });

    //Barra di ricerca
    const searchInput = document.getElementById("searchInput");

    searchInput.addEventListener("input", function () {
        const query = this.value.toLowerCase().trim();

        if (!query) {
            resetMap();
            return;
        }

        selectedLayer = null;

        allCableLayers.forEach(layer => { //Filtra i cavi in base alla ricerca
            const p = layer.feature.properties;

            const ownerRaw = p.ownersOfficial && p.ownersOfficial !== "n.a."
                ? p.ownersOfficial
                : p.owner || "";

            const matchesCable = p.displayName.toLowerCase().includes(query);
            const matchesOwner = ownerRaw.toLowerCase().includes(query);

            if (matchesCable || matchesOwner) {
                layer.setStyle({ opacity: 2, weight: 5 });
            } else {
                layer.setStyle({ opacity: 0.05 });
            }
        });

        allPointLayers.forEach(lp => { //Opacizza tutti i landing point
            lp.setStyle({ fillOpacity: 0.2 });
        });
    });

    //Timeline
    const yearSlider = document.getElementById("yearSlider");
    const yearDisplay = document.getElementById("current-year-display");

    yearSlider.addEventListener("input", function() {
        const selectedYear = parseInt(this.value);
        yearDisplay.innerText = selectedYear;

        allCableLayers.forEach(layer => { //Filtra cavi per anno
            const p = layer.feature.properties;
            let cableYear = 0;

            if (p.rfs) {
                const match = p.rfs.match(/\d{4}/);
                if (match) cableYear = parseInt(match[0]);
            }

            if (cableYear === 0 || cableYear > selectedYear) { //Nascondi se: non ha data OPPURE data > anno selezionato
                layer.setStyle({ opacity: 0, fillOpacity: 0, interactive: false });
                if (layer.getTooltip()) layer.unbindTooltip();
            } else {
                layer.setStyle({ //Mostra se: ha data e data <= anno selezionato
                    opacity: 1,
                    fillOpacity: 1,
                    interactive: true,
                    color: p.color || "#ff3333"
                });
                layer.bindTooltip(`<b>${p.displayName}</b>`, { sticky: true });
            }
        });

        //Filtra landing points in base ai cavi visibili
        allPointLayers.forEach(pointLayer => {
            const pointName = pointLayer.feature.properties.name;

            const hasVisibleCable = allCableLayers.some(cableLayer => {
                const cp = cableLayer.feature.properties;
                const cableYearMatch = cp.rfs ? cp.rfs.match(/\d{4}/) : null;
                const cableYear = cableYearMatch ? parseInt(cableYearMatch[0]) : 0;

                const isCableVisible = cableYear > 0 && cableYear <= selectedYear;

                return isCableVisible && cp.connections && cp.connections.includes(pointName);
            });

            if (hasVisibleCable) {
                pointLayer.setStyle({ opacity: 1, fillOpacity: 1, radius: 3 });
            } else {
                pointLayer.setStyle({ opacity: 0, fillOpacity: 0, radius: 0 });
            }
        });
    });
}

init();