(() => {
  "use strict";

  const gallery = document.getElementById("gallery");
  const IMAGE_EXTENSIONS = [
    "jpg",
    "jpeg",
    "png",
    "webp",
    "avif",
    "gif"
  ];

  function makeElement(tag, className, text) {
    const element = document.createElement(tag);

    if (className) {
      element.className = className;
    }

    if (text !== undefined) {
      element.textContent = text;
    }

    return element;
  }

  function slugify(value) {
    return String(value)
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/ß/g, "ss")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function imageCandidates(number) {
  const value = String(number ?? "").trim();

  if (!value) {
    return [];
  }

  return [`assets/jpg/${value}.jpg`];
}

  function setImage(image, candidates, index, name) {
    if (index >= candidates.length) {
      const fallback = makeElement(
        "div",
        "image-fallback"
      );

      fallback.append(
        makeElement(
          "strong",
          "",
          "Bild nicht gefunden"
        ),
        makeElement(
          "span",
          "",
          `Erwartet wird eine Bilddatei wie ${
            candidates[0] || "name.jpg"
          }.`
        )
      );

      image.replaceWith(fallback);
      return;
    }

    image.src = candidates[index];
    image.alt = name;

    image.onerror = () => {
      setImage(
        image,
        candidates,
        index + 1,
        name
      );
    };
  }

  function getNumber(card) {
    // Kartennummern werden niemals automatisch vergeben.
    // Es zählt ausschließlich der Wert aus der JSON-Datei.

    const value = card.Nummer;

    if (value === null || value === undefined) {
      return "";
    }

    return String(value).trim();
  }

  function isUnavailable(card) {
    // Nur der explizite Wert "nein" markiert eine Karte
    // als nicht verfügbar. Fehlende Werte gelten als verfügbar.

    return (
      String(card["Noch zu haben"] ?? "ja")
        .trim()
        .toLocaleLowerCase("de-DE") === "nein"
    );
  }

  function makeCard(card) {
	const number = getNumber(card);

	const name = String(
	  card.Name || (number ? `Karte ${number}` : "Unbenannte Karte")
	).trim();
	
    const story = String(
      card["Background-Story"] ||
      "Für diese Karte wurde noch keine Background-Story hinterlegt."
    ).trim();

    const unavailable = isUnavailable(card);

    const article = makeElement(
      "article",
      `card-item${unavailable ? " is-unavailable" : ""}`
    );

    // Kartenfläche und Bedienung
    const scene = makeElement(
      "button",
      "card-scene"
    );

    scene.type = "button";
    scene.setAttribute("aria-pressed", "false");

    scene.setAttribute(
      "aria-label",
      `${name}: Karte umdrehen${
        unavailable ? " (nicht mehr verfügbar)" : ""
      }`
    );

    const inner = makeElement(
      "span",
      "card-inner"
    );

    // Vorderseite
    const front = makeElement(
      "span",
      "card-face card-front"
    );

    front.setAttribute("aria-hidden", "false");

    const image = document.createElement("img");

    image.loading = "lazy";
    image.decoding = "async";
    image.width = 500;
    image.height = 700;

    setImage(
      image,
      imageCandidates(number),
      0,
      name
    );

    front.appendChild(image);

    // Verfügbarkeitshinweis
    const availabilityBadge = makeElement(
      "span",
      "availability-badge",
      "Nicht verfügbar"
    );

    availabilityBadge.setAttribute(
      "aria-hidden",
      unavailable ? "false" : "true"
    );

    front.appendChild(availabilityBadge);

    // Rückseite
    const back = makeElement(
      "span",
      "card-face card-back"
    );

    back.setAttribute("aria-hidden", "true");

    back.appendChild(
      makeElement("span", "back-title", name)
    );

    back.appendChild(
      makeElement("span", "back-rule")
    );

    back.appendChild(
      makeElement("span", "back-content", story)
    );

    // Informationen am unteren Kartenrand
    const footer = makeElement(
      "span",
      "back-footer"
    );

    footer.appendChild(
      makeElement(
        "span",
        "back-status",
        unavailable
          ? "Nicht verfügbar"
          : "Noch zu haben"
      )
    );

    footer.appendChild(
      makeElement(
        "span",
        "back-number",
        number ? `Nr. ${number}` : "Nummer offen"
      )
    );

    back.appendChild(footer);

    // Kartenflächen zusammenfügen
    inner.append(front, back);
    scene.appendChild(inner);
    article.appendChild(scene);

    // Beschriftung unterhalb der Karte
    const caption = makeElement(
      "div",
      "card-caption"
    );

    caption.appendChild(
      makeElement("strong", "", name)
    );

    caption.appendChild(
      makeElement(
        "span",
        "card-number",
        number ? `Nr. ${number}` : "Nummer offen"
      )
    );

    article.appendChild(caption);

    // Karte bei Klick umdrehen
    function flipCard() {
      const flipped = scene.classList.toggle(
        "is-flipped"
      );

      scene.setAttribute(
        "aria-pressed",
        String(flipped)
      );

      scene.setAttribute(
        "aria-label",
        flipped
          ? `${name}: Vorderseite zeigen`
          : `${name}: Karte umdrehen${
              unavailable
                ? " (nicht mehr verfügbar)"
                : ""
            }`
      );

      front.setAttribute(
        "aria-hidden",
        String(flipped)
      );

      back.setAttribute(
        "aria-hidden",
        String(!flipped)
      );
    }

    //scene.addEventListener("click", flipCard);

    return article;
  }

  function showMessage(message, isError = false) {
    const status = makeElement(
      "p",
      `status-message${isError ? " is-error" : ""}`,
      message
    );

    gallery.replaceChildren(status);

    gallery.setAttribute(
      "aria-busy",
      "false"
    );
  }
  
  // Karten zufällig mischen (Fisher-Yates-Algorithmus)
  function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));

      [array[i], array[j]] = [array[j], array[i]];
    }

    return array;
  }  

  async function init() {
    try {
      // Kartendaten aus der JSON-Datei laden
      const response = await fetch(
        "assets/json/karten.json",
        { cache: "no-store" }
      );

      if (!response.ok) {
        throw new Error(
          `karten.json konnte nicht geladen werden (HTTP ${response.status}).`
        );
      }

      const cards = await response.json();

      if (!Array.isArray(cards)) {
        throw new Error(
          "karten.json muss ein JSON-Array mit Kartenobjekten enthalten."
        );
      }
      
// Alle gültigen Karten mit Kartennummer verwenden
const validCards = cards.filter(
  (card) =>
    card &&
    typeof card === "object" &&
    !Array.isArray(card) &&
    String(card.Nummer ?? "").trim() !== ""
);

      if (validCards.length === 0) {
        showMessage(
          "Noch keine Karten vorhanden. Ergänze karten.json um ein Kartenobjekt mit Nummer, Name und Background-Story."
        );

        return;
      }

      // Galerie aufbauen, Reihenfolge aus JSON beibehalten
      /*
      const fragment = document.createDocumentFragment();

      validCards.forEach((card) => {
        fragment.appendChild(makeCard(card));
      });

      gallery.replaceChildren(fragment);
      */
      
      // Karten zufällig anordnen, ursprüngliche Nummern beibehalten
      const shuffledCards = shuffleArray([...validCards]);

      // Galerie mit der gemischten Reihenfolge aufbauen
      const fragment = document.createDocumentFragment();

      shuffledCards.forEach((card) => {
        fragment.appendChild(makeCard(card));
      });

      gallery.replaceChildren(fragment);      

      gallery.setAttribute(
        "aria-busy",
        "false"
      );
    } catch (error) {
      console.error(
        "KI Sammelkarten:",
        error
      );

      showMessage(
        "Die Karten konnten nicht geladen werden. Öffne die Seite bitte über einen Webserver (z. B. Apache) und prüfe, ob karten.json korrektes JSON enthält.",
        true
      );
    }
  }

  // Galerie starten
  init();
})();
