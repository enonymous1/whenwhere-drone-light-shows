// Venue picker for the workbench: an address search plus an
// interactive map (Leaflet + OpenStreetMap tiles, vendored locally)
// in a modal, so the venue's latitude/longitude can be picked by
// clicking instead of typed from memory.
//
// Flow: type an address and press "Find on map" (or Enter) — the
// address is geocoded with Nominatim (OpenStreetMap's free search,
// no key), the map centres on it, and a draggable pin marks the
// takeoff grid. Click the map or drag the pin to refine it, then
// "Use this location" writes the latitude/longitude into the venue
// fields (dispatching input events, so the workbench saves them and
// enables the Google Earth export exactly as if they were typed).
//
// The map is created lazily on the first open: Leaflet cannot size a
// map whose container is hidden, so it is built once the modal is
// visible, and invalidateSize() is called on later opens. If the
// venue already has coordinates, the map opens there; otherwise it
// opens on Spotsylvania, VA (home ground).
(function () {
  'use strict';

  var addressEl = /** @type {HTMLInputElement} */ (document.getElementById('venueAddress'));
  var mapBtn = document.getElementById('venueMapBtn');
  var modal = document.getElementById('venueModal');
  var mapEl = document.getElementById('venueMap');
  var coordsEl = document.getElementById('venueMapCoords');
  var noteEl = document.getElementById('venueAddressNote');
  var useBtn = document.getElementById('venueMapUse');
  var cancelBtn = document.getElementById('venueMapCancel');
  var closeBtn = document.getElementById('venueModalClose');
  var latEl = /** @type {HTMLInputElement} */ (document.getElementById('venueLat'));
  var lonEl = /** @type {HTMLInputElement} */ (document.getElementById('venueLon'));
  var demoSelect = /** @type {HTMLSelectElement} */ (document.getElementById('venueDemoSite'));

  // Spotsylvania, VA — home ground, used when no venue is set yet.
  var DEFAULT_LAT = 38.2019;
  var DEFAULT_LON = -77.5846;

  var map = null;
  var marker = null;
  var lastFocus = null;

  function fmt(n) { return n.toFixed(6); }

  function showCoords(lat, lon) {
    coordsEl.textContent = 'Takeoff grid: ' + fmt(lat) + ', ' + fmt(lon);
  }

  function currentPin() {
    if (!marker) return null;
    var ll = marker.getLatLng();
    return { latitude: ll.lat, longitude: ll.lng };
  }

  function setPin(lat, lon) {
    if (!marker) return;
    marker.setLatLng([lat, lon]);
    showCoords(lat, lon);
  }

  function note(msg) { noteEl.textContent = msg; }

  // The demo-location dropdown resets when the pin is moved by hand,
  // so it never claims a spot the pin has left.
  function resetDemoSelect() { if (demoSelect) demoSelect.value = ''; }

  function openModal() {
    if (typeof L === 'undefined') {
      note('The map did not load (Leaflet is missing) — type the latitude and longitude directly.');
      return;
    }
    lastFocus = document.activeElement;
    modal.hidden = false;
    if (!map) {
      var venue = null;
      try {
        var lat = Number(latEl.value);
        var lon = Number(lonEl.value);
        if (latEl.value && lonEl.value && isFinite(lat) && isFinite(lon)) venue = { lat: lat, lon: lon };
      } catch (e) { /* no saved venue — use the default */ }
      var start = venue || { lat: DEFAULT_LAT, lon: DEFAULT_LON };
      map = L.map(mapEl).setView([start.lat, start.lon], venue ? 15 : 12);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);
      // A CSS pin (divIcon), so no marker image files are needed.
      marker = L.marker([start.lat, start.lon], {
        draggable: true,
        icon: L.divIcon({ className: 'venue-pin', html: '', iconSize: [22, 22], iconAnchor: [11, 11] }),
      }).addTo(map);
      marker.on('dragend', function () {
        var ll = marker.getLatLng();
        showCoords(ll.lat, ll.lng);
        resetDemoSelect();
      });
      map.on('click', function (e) { setPin(e.latlng.lat, e.latlng.lng); resetDemoSelect(); });
      showCoords(start.lat, start.lon);
    } else {
      map.invalidateSize();
      var pin = currentPin();
      if (pin) showCoords(pin.latitude, pin.longitude);
    }
    closeBtn.focus();
  }

  function closeModal() {
    modal.hidden = true;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  // Geocode an address with Nominatim (one result). Returns a promise
  // of { lat, lon, display } or null when nothing matches.
  function geocode(address) {
    var url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(address);
    return fetch(url, { headers: { 'Accept': 'application/json' } })
      .then(function (r) {
        if (!r.ok) throw new Error('search failed');
        return r.json();
      })
      .then(function (rows) {
        if (!rows || !rows.length) return null;
        return { lat: Number(rows[0].lat), lon: Number(rows[0].lon), display: rows[0].display_name };
      });
  }

  function findAndOpen() {
    var address = addressEl.value.trim();
    openModal();
    if (!address || !map) return;
    note('Searching for “' + address + '”…');
    geocode(address).then(function (found) {
      if (!found || !isFinite(found.lat) || !isFinite(found.lon)) {
        note('No match for “' + address + '” — try a town, a street, or a venue name, or click the map to place the pin.');
        return;
      }
      map.setView([found.lat, found.lon], 16);
      setPin(found.lat, found.lon);
      note('Found: ' + found.display + ' — drag the pin (or click the map) to place the takeoff grid exactly.');
    }).catch(function () {
      note('The address search is unreachable right now — click the map to place the pin, or type the latitude and longitude directly.');
    });
  }

  mapBtn.addEventListener('click', findAndOpen);
  addressEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); findAndOpen(); }
  });
  // Demo locations: a preset list of open Charlottesville sites (from
  // the locations review) that jump the map and the pin straight there,
  // so a demo venue can be picked without typing an address or
  // geocoding. The pin is still free to drag or click elsewhere.
  if (demoSelect) {
    demoSelect.addEventListener('change', function () {
      var v = demoSelect.value;
      if (!v || !map) return;
      var parts = v.split(',');
      var lat = Number(parts[0]), lon = Number(parts[1]);
      if (!isFinite(lat) || !isFinite(lon)) return;
      map.setView([lat, lon], 16);
      setPin(lat, lon);
      note('Demo location: ' + demoSelect.options[demoSelect.selectedIndex].text + ' — drag the pin (or click the map) to place the takeoff grid exactly.');
    });
  }
  useBtn.addEventListener('click', function () {
    var pin = currentPin();
    if (!pin) { closeModal(); return; }
    latEl.value = fmt(pin.latitude);
    lonEl.value = fmt(pin.longitude);
    // Dispatch input so the workbench saves the venue and enables
    // the Google Earth export, exactly as if they were typed.
    latEl.dispatchEvent(new Event('input', { bubbles: true }));
    lonEl.dispatchEvent(new Event('input', { bubbles: true }));
    closeModal();
  });
  cancelBtn.addEventListener('click', closeModal);
  closeBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !modal.hidden) closeModal();
  });
})();
