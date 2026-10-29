(() => {
  "use strict";

  const gallery = document.getElementById("gallery");
  if (!gallery) return;

  function makeElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  const modal = makeElement("div", "card-modal");
  modal.id = "card-modal";
  modal.hidden = true;
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-label", "Sammelkarten-Großansicht");
  modal.setAttribute("tabindex", "-1");

  const closeButton = makeElement("button", "card-modal__close", "×");
  closeButton.type = "button";
  closeButton.setAttribute(
    "aria-label",
    "Großansicht schließen"
  );

  const previousButton = makeElement(
    "button",
    "card-modal__nav card-modal__nav--prev",
    "‹"
  );
  previousButton.type = "button";
  previousButton.setAttribute(
    "aria-label",
    "Vorherige Karte"
  );

  const nextButton = makeElement(
    "button",
    "card-modal__nav card-modal__nav--next",
    "›"
  );
  nextButton.type = "button";
  nextButton.setAttribute(
    "aria-label",
    "Nächste Karte"
  );

  const stage = makeElement("div", "card-modal__stage");
  const figure = makeElement("figure", "card-modal__figure");

  const modalImage = document.createElement("img");
  modalImage.className = "card-modal__image";
  modalImage.alt = "";
  modalImage.decoding = "async";
  modalImage.draggable = false;

  const caption = makeElement("figcaption", "card-modal__caption");
  const title = makeElement("strong", "card-modal__title");
  const counter = makeElement("span", "card-modal__counter");

  counter.setAttribute("aria-live", "polite");
  counter.setAttribute("aria-atomic", "true");

  caption.append(title, counter);
  figure.append(modalImage, caption);
  stage.appendChild(figure);

  modal.append(
    closeButton,
    previousButton,
    nextButton,
    stage
  );

  document.body.appendChild(modal);

  let modalItems = [];
  let currentIndex = 0;
  let lastFocusedElement = null;
  let previousBodyOverflow = "";
  let swipeStart = null;


  // Alle Karten in der aktuellen Galerie ermitteln
  function getGalleryItems() {
    return Array.from(
      gallery.querySelectorAll(".card-item")
    );
  }


  // Informationen einer Karte auslesen
  function getCardDetails(cardElement) {
    const galleryImage = cardElement.querySelector(
      ".card-front img"
    );

    const name =
      cardElement.querySelector(".card-caption strong")
        ?.textContent.trim() ||
      galleryImage?.alt ||
      "Sammelkarte";

    const numberLabel =
      cardElement.querySelector(".card-number")
        ?.textContent.trim() || "";

    const number = numberLabel.replace(/^Nr\.\s*/i, "");

    const source =
      galleryImage?.getAttribute("src") ||
      (
        number && number !== "Nummer offen"
          ? `assets/jpg/${number}.jpg`
          : ""
      );

    return {
      name,
      number,
      source
    };
  }


  // Karte anzeigen
  function showCard(index) {
    if (modalItems.length === 0) return;

    // Am Ende wieder zum Anfang springen und umgekehrt
    currentIndex =
      (index + modalItems.length) % modalItems.length;

    const details = getCardDetails(
      modalItems[currentIndex]
    );

    // Vorheriges Bild entfernen
    modalImage.removeAttribute("src");

    // Neues Bild laden
    if (details.source) {
      modalImage.src = details.source;
    }

    modalImage.alt =
      details.number &&
      details.number !== "Nummer offen"
        ? `${details.name}, Sammelkarte Nummer ${details.number}`
        : details.name;

    // Kartenname anzeigen
    title.textContent = details.name;

    // Kartenposition und Kartennummer anzeigen
    counter.textContent =
      `${currentIndex + 1} / ${modalItems.length}` +
      (
        details.number
          ? ` · ${
              details.number.startsWith("Nr.")
                ? details.number
                : `Nr. ${details.number}`
            }`
          : ""
      );

    // Beschriftung für Screenreader aktualisieren
    modal.setAttribute(
      "aria-label",
      `Sammelkarte in Großansicht: ${details.name}`
    );

    // Navigationspfeile bei nur einer Karte deaktivieren
    const canNavigate = modalItems.length > 1;

    previousButton.disabled = !canNavigate;
    nextButton.disabled = !canNavigate;
  }


  // Modal öffnen
  function openModal(index, trigger) {
    // Aktuelle Galerie-Reihenfolge übernehmen
    modalItems = getGalleryItems();

    if (modalItems.length === 0) return;

    // Element merken, das den Dialog geöffnet hat
    lastFocusedElement =
      trigger || document.activeElement;

    // Ursprünglichen Scrollzustand merken
    previousBodyOverflow = document.body.style.overflow;

    // Hintergrundscrollen verhindern
    document.body.style.overflow = "hidden";

    // Modal sichtbar machen
    modal.hidden = false;

    // Gewählte Karte anzeigen
    showCard(index);

    // Fokus auf Schließen-Button setzen
    closeButton.focus({
      preventScroll: true
    });
  }


  // Modal schließen
  function closeModal() {
    if (modal.hidden) return;

    modal.hidden = true;

    // Scrollen wieder erlauben
    document.body.style.overflow =
      previousBodyOverflow;

    // Eventuelle Wischbewegung zurücksetzen
    swipeStart = null;

    // Fokus zur ursprünglich angeklickten Karte zurückführen
    if (
      lastFocusedElement &&
      lastFocusedElement.isConnected &&
      typeof lastFocusedElement.focus === "function"
    ) {
      lastFocusedElement.focus({
        preventScroll: true
      });
    }
  }


  // Schließen-Button
  closeButton.addEventListener(
    "click",
    closeModal
  );


  // Vorherige Karte
  previousButton.addEventListener(
    "click",
    () => showCard(currentIndex - 1)
  );


  // Nächste Karte
  nextButton.addEventListener(
    "click",
    () => showCard(currentIndex + 1)
  );


  // Klick auf eine Karte öffnet das Modal.
  // Event-Delegation funktioniert auch dann,
  // wenn die Galerie später neu aufgebaut wird.
  gallery.addEventListener("click", (event) => {
    const target =
      event.target instanceof Element
        ? event.target
        : null;

    const scene = target?.closest(".card-scene");

    if (!scene || !gallery.contains(scene)) {
      return;
    }

    const cardElement = scene.closest(".card-item");

    const index = getGalleryItems().indexOf(
      cardElement
    );

    if (index >= 0) {
      openModal(index, scene);
    }
  });


  // Klick auf den dunklen Hintergrund schließt das Modal
  modal.addEventListener("click", (event) => {
    if (
      event.target === modal ||
      event.target === stage
    ) {
      closeModal();
    }
  });


  // Tastatursteuerung
  document.addEventListener("keydown", (event) => {
    if (modal.hidden) return;

    // Escape: schließen
    if (event.key === "Escape") {
      event.preventDefault();
      closeModal();
      return;
    }

    // Pfeil links: vorherige Karte
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      showCard(currentIndex - 1);
      return;
    }

    // Pfeil rechts: nächste Karte
    if (event.key === "ArrowRight") {
      event.preventDefault();
      showCard(currentIndex + 1);
      return;
    }

    // Tab: Fokus innerhalb des Modals halten
    if (event.key === "Tab") {
      const focusable = [
        closeButton,
        previousButton,
        nextButton
      ].filter((button) => !button.disabled);

      if (focusable.length === 0) {
        event.preventDefault();

        modal.focus();

        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      // Rückwärts am Anfang: zum letzten Element
      if (
        event.shiftKey &&
        document.activeElement === first
      ) {
        event.preventDefault();
        last.focus();
      }

      // Vorwärts am Ende: zum ersten Element
      else if (
        !event.shiftKey &&
        document.activeElement === last
      ) {
        event.preventDefault();
        first.focus();
      }
    }
  });


  // Touchscreen:
  // Wisch nach links = nächste Karte
  // Wisch nach rechts = vorherige Karte
  modal.addEventListener("pointerdown", (event) => {
    // Mausbewegungen ignorieren
    if (event.pointerType === "mouse") return;

    const target =
      event.target instanceof Element
        ? event.target
        : null;

    // Nur Wischbewegungen im Kartenbereich berücksichtigen
    if (!target?.closest(".card-modal__stage")) {
      return;
    }

    swipeStart = {
      x: event.clientX,
      y: event.clientY
    };
  });


  // Wischbewegung auswerten
  modal.addEventListener("pointerup", (event) => {
    if (!swipeStart) return;

    const deltaX =
      event.clientX - swipeStart.x;

    const deltaY =
      event.clientY - swipeStart.y;

    swipeStart = null;

    // Mindeststrecke und überwiegend horizontale Bewegung
    if (
      Math.abs(deltaX) >= 45 &&
      Math.abs(deltaX) > Math.abs(deltaY) * 1.25
    ) {
      showCard(
        currentIndex + (deltaX < 0 ? 1 : -1)
      );
    }
  });


  // Abgebrochene Touchbewegung zurücksetzen
  modal.addEventListener(
    "pointercancel",
    () => {
      swipeStart = null;
    }
  );

})();
