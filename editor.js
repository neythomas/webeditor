(() => {
	"use strict";

	const APP_VERSION = "1.2.2";
	const SAVE_DELAY = 500;						// Wartezeit nach letzter Änderung für die Auto-Speicherung
	const MAX_FILESIZE = 10 * 1024 * 1024;		// Maximale Dateigröße von ZIP-Archiven für Upload
	
	// Start-HTML (HTML-Grundgerüst als Vorlage beim Start)
	const START_HTML = `<!DOCTYPE html>
<html lang="de">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Meine erste Webseite</title>
	<link rel="stylesheet" href="style.css">
	<script src="script.js"></script>
</head>
<body>
	<!-- Dein Quelltext beginnt hier -->
	<h1>Hallo Welt!</h1>
	<p>Willkommen auf meiner ersten Webseite.</p>
</body>
</html>`;

	// Start-CSS (CSS-Grundgerüst als Vorlage beim Start)
	const START_CSS = `/* Gestalte hier deine Webseite */
body {
	font-family: Arial, sans-serif;
	margin: 1rem;
	background-color: #ffffff;
}

h1 {
	color: #ff0000;
}`;

	// Start-JavaScript (Beispiel-Befehl zum Start)
	const START_JS = `// Mache hier deine Webseite interaktiv
console.log("Hallo JavaScript!");`;

	const editors = {};

	// Voreinstellungen des ACE-Editors
	const setupEditor = (id, mode, initial) => {
		const editor = ace.edit(id);
		editor.setTheme("ace/theme/chrome");
		editor.session.setMode(`ace/mode/${mode}`);
		editor.setValue(initial, -1);
		editor.setOptions({
			fontSize: "14px",
			showPrintMargin: false,
			enableAutoIndent: true,
			useSoftTabs: false,
			tabSize: 4,
			enableBasicAutocompletion: true,
			enableLiveAutocompletion: true,
			enableSnippets: true,
			wrap: false
		});

		// Falls Ladefehler in der Konsole erscheinen: WebWorker deaktivieren (deaktiviert auch Syntax-Prüfung!)
		// editor.session.setUseWorker(false);

		return editor;
	};

	// Erzeuge drei Editorfenster mit den jeweiligen Startwerten
	editors.html = setupEditor("htmlEditor", "html", START_HTML);
	editors.css = setupEditor("cssEditor", "css", START_CSS);
	editors.js = setupEditor("jsEditor", "javascript", START_JS);

	const frame = document.getElementById("previewFrame");
	const status = document.getElementById("previewStatus");
	const saveStatus = document.getElementById("saveStatus");
	const storageKey = "webeditor";
	const projectTitleInput = document.getElementById("projectTitle");
	const projectTitleStorageKey = "webeditor-project";
	const editorLayoutStorageKey = "webeditor-layout";

	// Debounce-Timer für lokales Speichern und Vorschauaktualisierung
	let debounceTimer;

	// Einzelne Dateien über die Upload-Schaltfläche des jeweiligen Editors laden
	const individualUploads = [
		{ button: "uploadHtml", input: "uploadHtmlInput", type: "html", label: "HTML" },
		{ button: "uploadCss", input: "uploadCssInput", type: "css", label: "CSS" },
		{ button: "uploadJs", input: "uploadJsInput", type: "js", label: "JavaScript" }
	];

	// Ein Event-Handler für alle drei Dateien
	individualUploads.forEach(({ button, input, type, label }) => {
		
		// Erzeuge Dateiauswahl-Dialog
		const fileInput = document.getElementById(input);
		document.getElementById(button).addEventListener("click", () => fileInput.click());
		
		// Wird ausgelöst, sobald eine Datei ausgewählt wurde
		fileInput.addEventListener("change", async () => {
			const file = fileInput.files && fileInput.files[0];
			fileInput.value = ""; // Löschen, um erneute Auswahl derselben Datei zu erlauben
			
			if (!file) return;
			
			// Überschreiben bestätigen
			if (!confirm(`Möchten Sie den ${label}-Editor durch „${file.name}“ ersetzen?`)) return;
			
			try {
				editors[type].setValue(await file.text(), -1);
				window.clearTimeout(debounceTimer);
				saveLocally();
				updatePreview();
				saveStatus.textContent = `${label}-Datei geladen: ${file.name}`;
			} catch {
				alert(`Die ${label}-Datei konnte nicht gelesen werden.`);
			}
		});
	});

	// ZIP-Projekt über die Schaltfläche "Projekt öffnen" laden
	
	// Erzeuge Dateiauswahl-Dialog
	const importZipInput = document.getElementById("importZipInput");
	document.getElementById("importZipButton").addEventListener("click", () => importZipInput.click());
	
	// Wird ausgelöst, sobald eine ZIP-Datei ausgewählt wurde
	importZipInput.addEventListener("change", async () => {
		const file = importZipInput.files && importZipInput.files[0];
		importZipInput.value = "";
		if (!file) return;
		
		// Prüfe auf maximal erlaubte Dateigröße von 10 MB
		if (file.size > MAX_FILESIZE) {
			alert("Die ZIP-Datei ist größer als 10 MB und wird nicht geöffnet.");
			return;
		}
		
		if (typeof JSZip === "undefined") {
			alert("Die ZIP-Bibliothek konnte nicht geladen werden.");
			return;
		}
		if (!confirm(`Möchten Sie das aktuelle Projekt durch „${file.name}“ ersetzen?`)) return;
		try {
			// ZIP laden ohne Prüfsumme zu kontrollieren, um ein unnötges Entpacken des gesamten Archivs zu verhindern
			const zip = await JSZip.loadAsync(file, { checkCRC32: false });
			
			// Anzahl der Dateien und Verzeichnisse im ZIP-Archiv begrenzen
			const MAX_ZIP_ENTRIES = 100;
			if (Object.keys(zip.files).length > MAX_ZIP_ENTRIES) {
				throw new Error("Das ZIP-Archiv enthält zu viele Einträge.");
			}
			
			// Suche nach den passenden Dateinamen im Root der ZIP
			const getZipFile = name => {
				const entry = zip.file(name);
				return entry && !entry.dir ? entry : null;	// Verzeichnisse ausschließen
			};

			const htmlFile = getZipFile("index.html") || getZipFile("index.htm");
			const cssFile = getZipFile("style.css");
			const jsFile = getZipFile("script.js");

			// Prüfen, ob mindestens eine der erwarteten Dateien vorhanden ist.
			if (!htmlFile && !cssFile && !jsFile) {
				alert("In der ZIP-Datei wurden keine passenden Dateien gefunden.");
				return;
			}

			// Vorhandene Dateien als Text einlesen (Nicht vorhandene Dateien bleiben im jeweiligen Editor unverändert)
			const imported = {};
			if (htmlFile) imported.html = await htmlFile.async("string");
			if (cssFile) imported.css = await cssFile.async("string");
			if (jsFile) imported.js = await jsFile.async("string");

			// Die eingelesenen Inhalte den passenden Editoren zuweisen.
			for (const [type, content] of Object.entries(imported)) {
				editors[type].setValue(content, -1);
			}
			
			// Übernehme den Namen der ZIP-Datei als Projektnamen
			projectTitleInput.value = file.name.replace(/\.zip$/i, "").slice(0, 80) || "Webseitenprojekt";
			
			window.clearTimeout(debounceTimer);
			saveLocally();
			updatePreview();

			saveStatus.textContent = `ZIP-Projekt geladen: ${projectTitleInput.value}`;

			// Fehlende Dateien ermitteln
			const missing = [
				!htmlFile && "index.html",
				!cssFile && "style.css",
				!jsFile && "script.js"
			].filter(Boolean);
			if (missing.length) alert(`ZIP-Projekt geladen. Folgende Inhalte konnten nicht geladen werden: ${missing.join(", ")}`);
		} catch {
			alert("Die ZIP-Datei ist ungültig oder konnte nicht gelesen werden.");
		}
	});

	// Hole den Inhalt aller drei Editoren
	function getCode() {
		return {
			html: editors.html.getValue(),
			css: editors.css.getValue(),
			js: editors.js.getValue()
		};
	}

	// Erzeuge die Vorschau
	function createPreviewDocument() {
		const code = getCode();

		// CSS und JavaScript für die Vorschau vorbereiten
		const css = code.css.replace(/<\/style/gi, "<\\/style");
		const js = code.js.replace(/<\//g, "<\\/");

		// HTML nur für die Vorschau bearbeiten
		let html = code.html;

		// Externe Verweise auf die Projektdateien nur in Preview entfernen (Im Download sollen sie erhalten bleiben)
		html = html.replace(/<link\b[^>]*\bhref\s*=\s*["']style\.css["'][^>]*>/gi, "");
		html = html.replace(/<script\b[^>]*\bsrc\s*=\s*["']script\.js["'][^>]*>\s*<\/script>/gi, "");

		// Stattdessen CSS und JavaScript direkt einbetten
		const styleTag = `<style>\n${css}\n</style>`;
		const scriptTag = `<script>\n${js}\n<\/script>`;

		// Falls </head> vorhanden: CSS davor setzen, ansonsten an den Anfang
		if (/<\/head>/i.test(html)) {
			html = html.replace(/<\/head>/i, `${styleTag}\n</head>`);
		} else {
			html = `${styleTag}\n${html}`;
		}

		// Falls </body> vorhanden: JS davor setzen, ansonsten ans Ende
		if (/<\/body>/i.test(html)) {
			html = html.replace(/<\/body>/i, `${scriptTag}\n</body>`);
		} else {
			html += `\n${scriptTag}`;
		}

		return html;
	}

	// Aktualisiere die Vorschau (inkl. Statusanzeige)
	function updatePreview() {
		status.innerHTML = '<i class="fa-solid fa-rotate"></i> Aktualisiere...';

		frame.onload = () => {
			status.innerHTML = '<i class="fa-solid fa-check"></i> Aktuell';
		};

		frame.srcdoc = createPreviewDocument();
	}

	// Speichere die Editor-Inhalte im lokalen Browserspeicher
	function saveLocally() {
		try {
			localStorage.setItem(storageKey, JSON.stringify(getCode()));
			localStorage.setItem(projectTitleStorageKey, projectTitleInput.value);
			saveStatus.textContent = "Änderungen lokal gespeichert";
		} catch {
			saveStatus.textContent = "Der lokale Speicher ist nicht verfügbar!";
		}
	}

	// Lade Inhalte aus lokalem Speicher
	function loadLocally() {
		try {
			const savedTitle = localStorage.getItem(projectTitleStorageKey);

			if (savedTitle !== null) { projectTitleInput.value = savedTitle; }

			const saved = JSON.parse(localStorage.getItem(storageKey) || "null");

			if (saved && typeof saved.html === "string" && typeof saved.css === "string" && typeof saved.js === "string" ) {
				editors.html.setValue(saved.html, -1);
				editors.css.setValue(saved.css, -1);
				editors.js.setValue(saved.js, -1);
			}
		} catch {
			// Ignoriere fehlerhafte lokale Speicherung
		}
	}

	// Nach 500ms ohne Änderung: lokal speichern und Vorschau aktualisieren (Debounce)
	Object.values(editors).forEach(editor => {
		editor.session.on("change", () => {
			// Änderungen kennzeichnen, bis die automatische Speicherung erfolgt
			saveStatus.textContent = "Ungespeicherte Änderungen";
			window.clearTimeout(debounceTimer);

			debounceTimer = window.setTimeout(() => {
				saveLocally();
				updatePreview();
			}, SAVE_DELAY);
		});
	});

	// Belege Vorschau/Aktualisieren-Buttons mit Funktion
	document.getElementById("runButton").addEventListener("click", updatePreview);
	document.getElementById("refreshPreview").addEventListener("click", updatePreview);

	// Speichere den Zustand (zugeklappt/geöffnet) aller Editoren lokal
	function saveEditorLayout() {
		try {
			const layout = {};

			document.querySelectorAll("[data-collapse]").forEach(button => {
				const name = button.dataset.collapse;
				const panel = document.getElementById(`${name}Panel`);
				layout[name] = panel.classList.contains("collapsed");
			});

			localStorage.setItem(editorLayoutStorageKey, JSON.stringify(layout));
		} catch {
			// Ignoriere Fehler beim lokalen Speichern des Layouts
		}
	}

	// Stelle den zuletzt gespeicherten Zustand der Editoren wieder her
	function loadEditorLayout() {
		try {
			const savedLayout = JSON.parse(
				localStorage.getItem(editorLayoutStorageKey) || "null"
			);

			if (!savedLayout || typeof savedLayout !== "object") {
				return;
			}

			document.querySelectorAll("[data-collapse]").forEach(button => {
				const name = button.dataset.collapse;

				if (typeof savedLayout[name] !== "boolean") {
					return;
				}

				const collapsed = savedLayout[name];
				const panel = document.getElementById(`${name}Panel`);

				panel.classList.toggle("collapsed", collapsed);
				button.setAttribute("aria-expanded", String(!collapsed));

				button.title = collapsed
					? `${name.toUpperCase()}-Editor ausklappen`
					: `${name.toUpperCase()}-Editor einklappen`;
					
				button.setAttribute("aria-label", button.title);

				button.innerHTML = collapsed
					? '<i class="fa-solid fa-chevron-down" aria-hidden="true"></i>'
					: '<i class="fa-solid fa-chevron-up" aria-hidden="true"></i>';
			});
		} catch {
			// Ignoriere fehlerhafte lokale Layout-Speicherung
		}

		Object.values(editors).forEach(editor => editor.resize());
	}

	// Lade gespeicherten Editorzustand (vor der Registrierung der Klick-Handler)
	loadEditorLayout();

	// Mache einzelne Editoren zusammenklappbar
	document.querySelectorAll("[data-collapse]").forEach(button => {
		button.addEventListener("click", () => {
			const name = button.dataset.collapse;
			const panel = document.getElementById(`${name}Panel`);
			const collapsed = panel.classList.toggle("collapsed");

			button.setAttribute("aria-expanded", String(!collapsed));

			button.title = collapsed
				? `${name.toUpperCase()}-Editor ausklappen`
				: `${name.toUpperCase()}-Editor einklappen`;
				
			button.setAttribute("aria-label", button.title);

			button.innerHTML = collapsed
				? '<i class="fa-solid fa-chevron-down" aria-hidden="true"></i>'
				: '<i class="fa-solid fa-chevron-up" aria-hidden="true"></i>';

			// Zustand der Editoren im localStorage sichern
			saveEditorLayout();

			window.setTimeout(() => {
				Object.values(editors).forEach(editor => editor.resize());
			}, 200);
		});
	});

	// Bereite Download einzelner Skripte vor
	function downloadFile(name, content, type = "text/plain;charset=utf-8") {
		const blob = new Blob([content], { type });
		const url = URL.createObjectURL(blob);
		const link = document.createElement("a");

		link.href = url;
		link.download = name;

		document.body.appendChild(link);
		link.click();
		link.remove();

		// Warte kurz, bis die URL widerrufen wird
		window.setTimeout(() => {
			URL.revokeObjectURL(url);
		}, 1000);
	}

	// Belege Download-Buttons mit Funktion
	document.getElementById("downloadHtml").addEventListener("click", () =>	downloadFile("index.html", getCode().html, "text/html;charset=utf-8"));
	document.getElementById("downloadCss").addEventListener("click", () => downloadFile("style.css", getCode().css, "text/css;charset=utf-8"));
	document.getElementById("downloadJs").addEventListener("click", () => downloadFile("script.js", getCode().js, "text/javascript;charset=utf-8"));

	// Erzeuge Projekt als ZIP-Datei (mit JSZip)
	document.getElementById("downloadZip").addEventListener("click", async () => {
		// Prüfe, ob JSZip geladen wurde
		if (typeof JSZip === "undefined") {
			alert("Die ZIP-Bibliothek konnte nicht geladen werden.");
			return;
		}

		// Hole die Editorinhalte und erzeuge aus ihnen drei Dateien
		const code = getCode();
		const zip = new JSZip();

		zip.file("index.html", code.html);
		zip.file("style.css", code.css);
		zip.file("script.js", code.js);

		// Verwende den Projektnamen als Dateinamen
		const projectTitle = projectTitleInput.value.trim() || "Webseitenprojekt";

		const safeFileName = projectTitle
			.normalize("NFKD")
			.replace(/[\u0300-\u036f]/g, "")
			.replace(/[^a-zA-Z0-9_-]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 80) || "Webseitenprojekt";

		try {
			const blob = await zip.generateAsync({ type: "blob" });
			downloadFile(`${safeFileName}.zip`, blob, "application/zip");
		} catch {
			alert("Das ZIP-Projekt konnte nicht erstellt werden.");
		}
	});

	// Nutze die Beautify-Extension, um Code aufzuräumen
	
	// Belege die Aufräumen-Buttons mit Funktion
	document.querySelectorAll("[data-format]").forEach(button => {
		button.addEventListener("click", () => {
			const editor = editors[button.dataset.format];

			try {
				const beautify = ace.require("ace/ext/beautify");
				beautify.beautify(editor.session);
			} catch {
				alert("Die Aufräum-Funktion steht aktuell nicht zur Verfügung.");
			}
		});
	});

	// Belege den Zurücksetzen-Button mit Funktion
	document.getElementById("resetButton").addEventListener("click", () => {
		if (!confirm("Wollen Sie wirklich alle drei Editorfenster auf den Ausgangszustand zurücksetzen?")) {
			return;
		}

		// Defaultwerte erneut laden
		editors.html.setValue(START_HTML, -1);
		editors.css.setValue(START_CSS, -1);
		editors.js.setValue(START_JS, -1);

		// Lokalen Speicher überschreiben und Vorschau aktualisieren
		saveLocally();
		updatePreview();
	});

	// Setze den Light- oder Dark-Mode
	function setTheme(dark) {
		document.body.classList.toggle("dark-theme", dark);

		// Button je nach Modus wechseln und Beschriftung aktualisieren
		themeToggle.innerHTML = dark
			? '<i class="fa-solid fa-sun" aria-hidden="true"></i>'
			: '<i class="fa-solid fa-moon" aria-hidden="true"></i>';
		const themeLabel = dark
			? "Lightmode aktivieren"
			: "Darkmode aktivieren";
		themeToggle.title = themeLabel;
		themeToggle.setAttribute("aria-label", themeLabel);

		// Setze das zum Modus passende Theme für alle ACE-Fenster
		Object.values(editors).forEach(editor => {
			editor.setTheme(
				dark
					? "ace/theme/monokai"
					: "ace/theme/chrome"
			);
		});

		// Gewählten Modus lokal speichern
		try {
			localStorage.setItem("webeditor-theme", dark ? "dark" : "light");
		} catch {
			saveStatus.textContent = "Einstellungen konnten nicht lokal gespeichert werden";			
		}
	}

	const themeToggle = document.getElementById("themeToggle");

	// Gespeicherten Modus beim Laden wiederherstellen
	let savedTheme = "light";

	try {
		savedTheme = localStorage.getItem("webeditor-theme") || "light";
	} catch { }
	
	// Standardmäßig helles Theme verwenden
	setTheme(savedTheme === "dark");
	
	// Light- und Darkmode per Button umschalten
	themeToggle.addEventListener("click", () => {
		const isDark = document.body.classList.contains("dark-theme");
		setTheme(!isDark);
	});

	// Projektnamen bei Änderungen automatisch speichern
	projectTitleInput.addEventListener("input", () => {
		saveStatus.textContent = "Ungespeicherte Änderungen";
		window.clearTimeout(debounceTimer);

		debounceTimer = window.setTimeout(() => {
			saveLocally();
		}, SAVE_DELAY);
	});

	// Lade gespeicherte Inhalte und aktualisiere die Vorschau
	loadLocally();
	saveStatus.textContent = "Gespeichert";
	updatePreview();

	// Zeige die Versionsnummer in der Statusleiste an
	const versionElement = document.getElementById("versionInfo");
	if (versionElement) { versionElement.innerHTML = '<a href="https://github.com/neythomas/webeditor" target="_blank" rel="noopener noreferrer"><i class="fa-brands fa-github"></i> Webeditor '+APP_VERSION+'</a>'; }

	// Passe die Editoren bei Fenstergrößenänderungen an
	window.addEventListener("resize", () =>
		Object.values(editors).forEach(editor => editor.resize())
	);
})();
