//Importo la funzione per caricare CSV come array di oggetti e importo le funzioni di normalizzazione, merge e collegamento dati
import { loadCSV } from "./loadCSV.js";
import {
  normalizeCable1,
  normalizeCable2,
  normalizeCable3,
  mergeCables,
  normalizeLandingPoints,
  attachNearestLandingPoints
} from "./dataService.js";

//Funzione che “srotola” le longitudini per evitare salti bruschi oltre il meridiano 180
function unwrapLongitudes(latlngs) {
  const result = [latlngs[0]];

  for (let i = 1; i < latlngs.length; i++) {
    let [lat, lon] = latlngs[i];
    let [prevLat, prevLon] = result[i - 1];

    while (lon - prevLon > 180) lon -= 360;
    while (lon - prevLon < -180) lon += 360;

    result.push([lat, lon]);
  }

  return result;
}

//Funzione che divide una polilinea in più segmenti quando attraversa l’antimeridiano
function splitOnAntimeridian(latlngs) {
  const parts = [];
  let current = [];

  for (let i = 0; i < latlngs.length; i++) {
    const p = latlngs[i];
    current.push(p);

    if (i === 0) continue;

    const prev = latlngs[i - 1];
    const prevLng = prev[1];
    const lng = p[1];

    if (Math.abs(lng - prevLng) > 180) {
      current.pop();
      if (current.length > 0) parts.push(current);

      current = [prev, p];
    }
  }

  if (current.length > 0) parts.push(current);

  return parts;
}

//Funzione per capire se un cavo è “lungo raggio” e quindi deve essere disegnato in modalità geodetica
function isLongDistanceCable(cable) {

  if (!cable.coordinates) return false;

  if (cable.coordinates.length <= 4) { //Se il cavo ha pochissimi punti, lo considero comunque lungo per evitare linee dritte
    return true;
  }

  const longRegions = [ //Lista di parole chiave che indicano cavi internazionali o transoceanici
    "Transatlantic",
    "Transpacific",
    "International",
    "Global",
    "Africa",
    "Asia",
    "South America",
    "Americas",
    "Pacific",
    "Atlantic"
  ];

  if (cable.region) {
    return longRegions.some(r =>
      cable.region.toLowerCase().includes(r.toLowerCase())
    );
  }

  return false;
}

const statusColors = { //Colori associati ai vari stati dei cavi
  "In Service": "#2c7bb6",
  "Abandoned": "#d7191c",
  "Under Construction": "#fdae61",
  "Out of Service": "#555555",
  "Unknown": "#999999"
};

function getCableStyle(status) { //Stile grafico standard dei cavi
  return {
    color: statusColors[status] || statusColors["Unknown"],
    weight: 1,
    opacity: 0.35
  };
}

function getHoverStyle(status) { //Stile applicato al passaggio del mouse
  return {
    color: statusColors[status] || statusColors["Unknown"],
    weight: 4,
    opacity: 0.9
  };
}

function getSelectedStyle(status) { //Stile applicato quando un cavo viene selezionato con un click
  return {
    color: "#ff7f00",   
    weight: 4,
    opacity: 1
  };
}

//Funzione asincrona che inizializza tutta la pipeline dati
async function init() {

  const raw1  = await loadCSV("../data/SubmarineCable1.csv"); //Caricamento dei CSV dal server locale
  const raw2  = await loadCSV("../data/SubmarineCable2.csv");
  const raw3  = await loadCSV("../data/SubmarineCable3.csv");
  const rawLP = await loadCSV("../data/PuntiDiAtterraggio.csv");

  const c1 = normalizeCable1(raw1); //Normalizo i tre dataset di cavi in un formato comune
  const c2 = normalizeCable2(raw2);
  const c3 = normalizeCable3(raw3);

  const cablesMerged = mergeCables(c1, c2, c3); //Unisco e normalizzo i cavi

  const landingPoints = normalizeLandingPoints(rawLP); //Normalizzo i punti di atterraggio 

  const cables = attachNearestLandingPoints(cablesMerged, landingPoints); //Associo a ogni cavo i due landing points più vicini

  //Funzione per contare quanti cavi appartengono a ogni stato
  function countByStatus(cables) { 
    const counts = {
      "In Service": 0,
      "Abandoned": 0,
      "Under Construction": 0,
      "Out of Service": 0,
      "Unknown": 0
    };

    cables.forEach(c => {
      const status = c.status && c.status.trim() !== "" ? c.status : "Unknown";
      if (counts[status] !== undefined) {
        counts[status]++;
      } else {
        counts["Unknown"]++;
      }
    });

    return counts;
  }

  const statusCounts = countByStatus(cables);

  const map = L.map("map").setView([20, 0], 2); //Inizializzo la mappa Leaflet centrata sul mondo

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { //Aggiungo il layer di base OpenStreetMap
    attribution: "© OpenStreetMap contributors"
  }).addTo(map);

  const allCablesLayer = L.layerGroup().addTo(map); //Layer dedicato ai cavi sottomarini
  
  const statusLayers = { //Layer separati per ogni stato dei cavi
    "In Service": L.layerGroup().addTo(map),
    "Abandoned": L.layerGroup().addTo(map),
    "Under Construction": L.layerGroup().addTo(map),
    "Out of Service": L.layerGroup().addTo(map),
    "Unknown": L.layerGroup().addTo(map)
  };

  const landingLayer = L.layerGroup().addTo(map); //Layer dedicato ai punti di atterraggio

  let selectedCable = null; //Variabile per gestire il cavo attualmente selezionato

  // Disegno dei cavi sulla mappa
  const cableLines = cables
    .filter(c => Array.isArray(c.coordinates) && c.coordinates.length >= 2)
    .map(c => {

      const cleaned = c.coordinates //Conversione coordinate da [lon,lat] a [lat,lon] per Leaflet
        .map(([lon, lat]) => [parseFloat(lat), parseFloat(lon)])
        .filter(([lat, lon]) => !isNaN(lat) && !isNaN(lon));

      if (cleaned.length < 2) return null;

      const unwrapped = unwrapLongitudes(cleaned); //Correzione longitudini e gestione antimeridiano
      const parts = splitOnAntimeridian(unwrapped);

      let line;

      const label = c.name || c.shortName || c.id || "cable"; //Nome visualizzato nel tooltip

      if (isLongDistanceCable(c) && typeof L.geodesic === "function") { //Scelta del tipo di disegno: geodetico per cavi lunghi, polilinea normale per cavi locali
        line = L.geodesic(parts, { 
          weight: 2,
          color: "#2171b5",
          opacity: 0.7
        })
      } else {        
        line = L.featureGroup( 
          parts.map(seg => L.polyline(seg, getCableStyle(c.status)))
        )      
      }

      const targetLayer = statusLayers[c.status] || statusLayers["Unknown"]; //Inserisco il cavo sia nel layer per stato sia nel layer generale

      line.addTo(targetLayer);
      line.addTo(allCablesLayer); 
      
      
      let popupText = `<b>${label}</b>`; //Costruzione del popup informativo del cavo

      // Proprietario
      if (c.owner) {
        popupText += `<br><b>Proprietario:</b> ${c.owner}`;
      } else if (c.owners) {
        popupText += `<br><b>Proprietario:</b> ${c.owners}`;
      }
      
      // Regione
      if (c.region) {
      popupText += `<br><b>Regione:</b> ${c.region}`;
    }
    
    // Stato
    if (c.status) {
      popupText += `<br><b>Stato:</b> ${c.status}`;
    }
    
    // Sistema del cavo (se presente)
    if (c.cableSystem) {
      popupText += `<br><b>Sistema:</b> ${c.cableSystem}`;
    }
    
    // Lunghezza stimata
    if (c.estimatedLengthKm) {
      popupText += `<br><b>Lunghezza stimata:</b> ${Math.round(c.estimatedLengthKm)} km`;
    } 
      
    line.bindPopup(popupText);

    line.bindTooltip(label, { sticky: true, direction: "top" }); //Tooltip con il nome del cavo

    line.on("mouseover", () => { //Evidenziazione temporanea al passaggio del mouse
      if (selectedCable !== line) {
        line.setStyle(getHoverStyle(c.status));
        line.bringToFront();
        }
      });

    line.on("mouseout", () => { //Ripristino dello stile originale
      if (selectedCable !== line) {
        line.setStyle(getCableStyle(c.status));
      }
    });

    line.on("click", () => { //Selezione persistente del cavo
      if (selectedCable && selectedCable !== line) {
        selectedCable.setStyle(cableStyle);
      }

       selectedCable = line;
       line.setStyle(getSelectedStyle(c.status));
       line.bringToFront();
      });

      return line;
    })
    .filter(l => l !== null);

  map.on("click", () => { //Deselezione del cavo cliccando su un’area vuota della mappa
    if (selectedCable) {
      selectedCable.setStyle(cableStyle);
      selectedCable = null;
    }
  });

  console.log("Cavi disegnati:", cableLines.length);  
  console.log("Landing points letti:", landingPoints.length);

  const landingMarkers = landingPoints.map(p => { //Disegno dei punti di atterraggio

    const marker = L.circleMarker([p.lat, p.lon], {
      radius: 3,
      color: "#d73027",
      fillColor: "#d73027",
      fillOpacity: 0.8,
      weight: 1
    }).addTo(landingLayer); 

    const label = p.name || p.id || "Landing point";

    marker.bindPopup(label); 
    marker.bindTooltip(label, { sticky: true, direction: "top" });

    return marker;
  });

  console.log("Landing points disegnati:", landingMarkers.length);

  const overlays = { //Controllo layer nella mappa (filtri laterali)
    "Tutti i cavi": allCablesLayer,
    [`In Service (${statusCounts["In Service"]})`]: statusLayers["In Service"],
    [`Under Construction (${statusCounts["Under Construction"]})`]: statusLayers["Under Construction"],
    [`Out of Service (${statusCounts["Out of Service"]})`]: statusLayers["Out of Service"],
    [`Abandoned (${statusCounts["Abandoned"]})`]: statusLayers["Abandoned"],    
    [`Sconosciuto (${statusCounts["Unknown"]})`]: statusLayers["Unknown"],
    "Punti di atterraggio": landingLayer
  };

  const legend = L.control({ position: "bottomright" }); //Creazione della legenda grafica

  legend.onAdd = function () {
    const div = L.DomUtil.create("div", "info legend");

    div.style.background = "white";
    div.style.padding = "10px";
    div.style.borderRadius = "5px";
    div.style.boxShadow = "0 0 5px rgba(0,0,0,0.3)";

    div.innerHTML = "<b>Leggenda Cavi</b><br><br>"; 

    const items = [
      { status: "In Service", color: statusColors["In Service"] },
      { status: "Under Construction", color: statusColors["Under Construction"] },
      { status: "Out of Service", color: statusColors["Out of Service"] },
      { status: "Abandoned", color: statusColors["Abandoned"] },
      { status: "Unknown", color: statusColors["Unknown"] }
    ];

    items.forEach(item => {
      const count = statusCounts[item.status] || 0;

      div.innerHTML +=
        `<i style="background:${item.color}; width:12px; height:12px; display:inline-block; margin-right:5px;"></i>` +
        `${item.status} (${count})<br>`;
    });

    return div;
  };

  legend.addTo(map);

  //Aggiungo il controllo layer alla mappa
  L.control.layers(null, overlays, { collapsed: false }).addTo(map);
}

init();
