import { loadMapData } from "./dataService.js";

//Inizializzazione mappa
const map = L.map("map", {
  worldCopyJump: true,
  minZoom: 2,
  maxBoundsViscosity: 1.0
}).setView([20, 0], 2);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

let selectedLayer = null; //Layer del cavo selezionato
let allCableLayers = []; //Tutti i layer dei cavi
let allPointLayers = []; //Tutti i layer dei landing point


//Funzione principale
async function init() {
  const { cables, landingPoints } = await loadMapData();

  //Funzione che aggiunge un layer GeoJSON alla mappa (data = dati; GeoJSONoffset = duplicazione mondo; isPoint = true se sono landing point)
  function addGeoJSONLayer(data, offset, isPoint = false) {

    return L.geoJSON(data, {

      coordsToLatLng: (coords) => L.latLng(coords[1], coords[0] + offset),  //Gestione duplicazione mondo

      style: (feature) => ({ //Stile linee dei cavi
        color: feature.properties.color || "#ff3333",
        weight: 2,
        opacity: 1,
        fillOpacity: 1
      }),

      pointToLayer: (feature, latlng) => { //Stile landing point
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

      onEachFeature: (feature, layer) => { //Gestione interazione per ogni feature
        const p = feature.properties;

        if (!isPoint) {

          allCableLayers.push(layer); //Salviamo il layer per ricerca e reset

          layer.bindTooltip(`<b>${p.displayName}</b>`, { //Tooltip con nome cavo
            sticky: true,
            direction: "auto",
            opacity: 0.9
          });

          //Dati dei popup
          const lengthToShow =
            p.officialLength && p.officialLength !== "n.a."
              ? p.officialLength
              : p.calculatedLength || "N/D";

          const ownerRaw =
            p.ownersOfficial && p.ownersOfficial !== "n.a."
              ? p.ownersOfficial
              : p.owner || "Informazione non disponibile";

          const formattedOwners = ownerRaw.includes(",")
            ? ownerRaw.split(",").map((o) => o.trim()).join("<br>")
            : ownerRaw;

          const listItems =
            p.connections.length > 0
              ? p.connections.map((name) => `<li>${name}</li>`).join("")
              : "<li>Nessun punto rilevato</li>";

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
                  <td style="color:#666;"><b>Lunghezza:</b></td>
                  <td>${lengthToShow}</td>
                </tr>
                <tr>
                  <td style="color:#666;"><b>Stato:</b></td>
                  <td>${p.status}</td>
                </tr>
                <tr>
                  <td style="color:#666; vertical-align:top;"><b>Proprietari:</b></td>
                  <td style="line-height:1.4;">${formattedOwners}</td>
                </tr>
                ${
                  p.rfs
                    ? `
                <tr>
                  <td style="color:#666;"><b>Data di messa in funzione:</b></td>
                  <td>${p.rfs}</td>
                </tr>`
                    : ""
                }
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
                  Punti di approdo
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

          //Logica per selezione cavo
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

            map.eachLayer((l) => { //Evidenzia landing point collegati
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

  //Funzione per il reset della mappa
  function resetMap() {
    allCableLayers.forEach((layer) => {
      layer.setStyle({ weight: 2, opacity: 1 });
    });

    allPointLayers.forEach((lp) => {
      lp.setStyle({
        radius: 3,
        fillColor: "#0D3B66",
        fillOpacity: 1,
        stroke: false,
        opacity: 1
      });
    });
  }

  map.on("click", () => {
    resetMap();
    selectedLayer = null;
  });

  //Duplicazione mondo
  [-360, 0, 360].forEach((offset) => {
    addGeoJSONLayer(cables, offset);
    addGeoJSONLayer(landingPoints, offset, true);
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

    allCableLayers.forEach(layer => {

      const p = layer.feature.properties;

      const ownerRaw =
        p.ownersOfficial && p.ownersOfficial !== "n.a."
          ? p.ownersOfficial
          : p.owner || "";

      const matchesCable = p.displayName.toLowerCase().includes(query);
      const matchesOwner = ownerRaw.toLowerCase().includes(query);

      if (matchesCable || matchesOwner) {
        layer.setStyle({ opacity: 1, weight: 5 });
      } else {
        layer.setStyle({ opacity: 0.05 });
      }
    });

    allPointLayers.forEach(lp => {
      lp.setStyle({ fillOpacity: 0.2 });
    });
  });

}

init();
