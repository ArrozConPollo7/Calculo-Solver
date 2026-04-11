(async () => {
    if (window.__solverActivo) { console.warn("[Solver Física] Ya está corriendo."); return; }
    window.__solverActivo = true;

    // ========================================================================
    // D2L GROQ SOLVER v29 - FÍSICA 1 (NC1001 EAFIT)
    // ========================================================================

    const GROQ_KEYS = ["DEPLOY_REPLACE_ME"];
    let currentKeyIndex = 0;
    const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
    const MODEL_TEXTO = "qwen/qwen3-32b";
    const MODEL_PRO = "gpt-oss-120b";
    const MODEL_VISION = "meta-llama/llama-4-scout-17b-16e-instruct";
    const MODEL_BACKUP = "moonshotai/kimi-k2-instruct-0905";

    // Keywords que activan el modelo PRO (preguntas de justificación / 30%)
    const KEYWORDS_PRO = [
        "justificación requerida", "(30%)", "30 puntos", "justifique",
        "coeficiente de fricción cinético", "fuerza de contacto",
        "trabajo y energía", "cuerda inextensible",
        "polea ideal", "tensión en la cuerda",
        "coeficiente de fricción estático", "parte del reposo",
        "fuerza de fricción promedio", "masa en suspensión", "fuerza mínima",
        "superficie horizontal", "equilibrio", "cuarto de círculo",
        "colisión", "energía cinética", "energía potencial"
    ];
    const nl = String.fromCharCode(10);
    const slash = String.fromCharCode(92);

    // —— Indicador disimulado POR PREGUNTA — puntos de color junto a cada pregunta ——
    // Estados: "detect" (gris), "loading" (naranja), "done" (verde), "error" (rojo)
    function crearIndicador(elementoRef, targetDoc) {
        const dot = targetDoc.createElement("span");
        dot.className = "__groq_dot__";
        dot.style.cssText = [
            "display:inline-block",
            "width:7px",
            "height:7px",
            "border-radius:50%",
            "background:#888",
            "opacity:0.3",
            "margin-left:6px",
            "vertical-align:middle",
            "transition:background 0.4s,opacity 0.4s",
            "position:relative",
            "top:-1px"
        ].join(";");
        try {
            const parent = elementoRef.parentElement;
            if (parent) parent.style.position = "relative";
            const firstChild = elementoRef.firstChild;
            if (firstChild) {
                elementoRef.insertBefore(dot, firstChild.nextSibling || firstChild);
            } else {
                elementoRef.appendChild(dot);
            }
        } catch (e) {
            targetDoc.body.appendChild(dot);
        }
        return dot;
    }

    function setIndicador(dot, estado) {
        if (!dot) return;
        const map = {
            detect: { bg: "#9ca3af", op: "0.30" },
            loading: { bg: "#f59e0b", op: "0.60" },
            done: { bg: "#22c55e", op: "0.70" },
            error: { bg: "#ef4444", op: "0.55" }
        };
        const s = map[estado] || map.detect;
        dot.style.background = s.bg;
        dot.style.opacity = s.op;
    }

    // —— Toggle Z — ocultar/mostrar TODOS los paneles y dots ——
    window.__groq_panels_visible__ = true;
    const toggleZ = (e) => {
        if (e.key.toLowerCase() !== "z") return;
        const now = Date.now();
        if (window.__groq_last_z__ && now - window.__groq_last_z__ < 300) return;
        window.__groq_last_z__ = now;
        window.__groq_panels_visible__ = !window.__groq_panels_visible__;
        const visible = window.__groq_panels_visible__;
        // Ocultar/mostrar paneles en todos los documentos posibles
        [document, getQuizDoc()].forEach(d => {
            try {
                d.querySelectorAll(".__groq_panel__").forEach(p => p.style.display = visible ? "none" : "none");
                d.querySelectorAll(".__groq_dot__").forEach(dot => dot.style.display = visible ? "inline-block" : "none");
            } catch (err) { }
        });
        // Los paneles se abren al hacer click en h2, solo ocultamos los dots
        console.log("[Solver] Indicadores " + (visible ? "visibles" : "ocultos"));
    };
    window.addEventListener("keydown", toggleZ);
    try {
        const i1 = document.getElementById("ctl_2");
        const d = i1?.contentDocument || document;
        d.addEventListener("keydown", toggleZ);
        const i2 = d.querySelector("iframe#FRM_page") || d.querySelector("iframe[name='pageFrame']");
        i2?.contentWindow?.addEventListener("keydown", toggleZ);
    } catch (e) { }

    // Mantener setStatus para compatibilidad (rate-limit logs)
    function setStatus(s) {
        // Solo log, los indicadores por pregunta manejan el estado visual
        if (s === "yellow") console.log("[Solver] Rate limit...");
        if (s === "red") console.warn("[Solver] Error");
    }

    // —— KaTeX — cargado en el iframe de las preguntas ————————————
    async function cargarKaTeX(targetDoc) {
        if (targetDoc.defaultView.katex) return;
        const link = targetDoc.createElement("link");
        link.rel = "stylesheet";
        link.href = "https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.css";
        targetDoc.head.appendChild(link);
        const loadScript = src => new Promise((res, rej) => {
            const s = targetDoc.createElement("script");
            s.src = src; s.onload = res; s.onerror = rej;
            targetDoc.head.appendChild(s);
        });
        await loadScript("https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.js");
        await loadScript("https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/contrib/auto-render.min.js");
    }

    function renderKaTeX(el, targetDoc) {
        const fn = targetDoc.defaultView.renderMathInElement;
        if (!fn) return;
        try {
            fn(el, {
                delimiters: [
                    { left: "$$", right: "$$", display: true },
                    { left: "$", right: "$", display: false },
                    { left: "\\(", right: "\\)", display: false },
                    { left: "\\[", right: "\\]", display: true }
                ],
                throwOnError: false, strict: false
            });
        } catch (e) { }
    }

    // —— Texto ————————————————————————————————————————————————————
    function stripThinking(raw) {
        return raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    }

    function prepararHTML(texto) {
        // Normalizar delimitadores
        texto = texto
            .split("\\(").join("$")
            .split("\\)").join("$")
            .split("\\[").join("$$")
            .split("\\]").join("$$");

        // Reemplazar saltos de línea SOLO fuera de bloques de LaTeX
        let result = "";
        let inBlock = false;
        let i = 0;
        while (i < texto.length) {
            if (!inBlock && texto[i] === "$" && texto[i + 1] === "$") {
                inBlock = true; result += "$$"; i += 2; continue;
            }
            if (inBlock && texto[i] === "$" && texto[i + 1] === "$") {
                inBlock = false; result += "$$"; i += 2; continue;
            }
            if (!inBlock && texto[i] === "\n") {
                result += "<br>"; i++; continue;
            }
            result += texto[i]; i++;
        }

        return result.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    }

    function htmlToText(html) {
        if (!html) return "";
        const d = document.createElement("div");
        d.innerHTML = html.replace(/&nbsp;/g, " ");
        return (d.textContent || d.innerText || "")
            .replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim();
    }

    // —— Obtener el documento real del quiz ———————————————————————
    function getQuizDoc() {
        try {
            const i1 = document.getElementById("ctl_2");
            const d1 = i1?.contentDocument;
            const i2 = d1?.getElementById("FRM_page") || d1?.querySelector("iframe[name='pageFrame']");
            if (i2?.contentDocument) return i2.contentDocument;
            if (d1) return d1;
        } catch (e) { }
        return document;
    }

    // —— UI — panel de justificación ——————————————————————————————
    function setupPanelClick(fieldset, panel, quizDoc) {
        // Subir desde el fieldset buscando el H2 en cada nivel padre
        let node = fieldset;
        for (let n = 0; n < 8; n++) {
            node = node.parentElement;
            if (!node || node === quizDoc.body) break;
            // Buscar H2 que sea hermano ANTERIOR dentro de este contenedor
            const siblings = Array.from(node.parentElement?.children || []);
            const nodeIdx = siblings.indexOf(node);
            for (let s = nodeIdx - 1; s >= 0; s--) {
                const h2 = siblings[s].tagName === "H2"
                    ? siblings[s]
                    : siblings[s].querySelector?.("h2.dhdg_2");
                if (h2) {
                    h2.style.cursor = "pointer";
                    h2.addEventListener("click", (e) => {
                        e.stopPropagation();
                        const isOpen = panel.style.display === "block";
                        quizDoc.querySelectorAll(".__groq_panel__")
                            .forEach(p => p.style.display = "none");
                        if (!isOpen) {
                            panel.style.display = "block";
                            setTimeout(() => renderKaTeX(panel, quizDoc), 80);
                        }
                    });
                    return h2;
                }
            }
        }
    }

    function crearPanel(fieldset, quizDoc) {
        // Eliminar panel previo si existe
        const prev = fieldset.nextElementSibling;
        if (prev && prev.classList.contains("__groq_panel__")) prev.remove();

        const panel = quizDoc.createElement("div");
        panel.className = "__groq_panel__";
        panel.style.cssText = [
            "display:none",
            "width:calc(100% - 2px)",
            "max-height:240px",
            "overflow-y:auto",
            "background:#fff",
            "border:1px solid #e2e8f0",
            "border-radius:6px",
            "padding:14px 16px",
            "margin:6px 0 14px 0",
            "font-family:'Segoe UI',system-ui,sans-serif",
            "font-size:13px",
            "line-height:1.9",
            "color:#1a1a1a",
            "box-shadow:0 2px 10px rgba(0,0,0,0.07)"
        ].join(";");
        panel.innerHTML = "<em style='color:#999;font-size:12px;'>⏳ Cargando justificación...</em>";

        // Insertar justo después del fieldset
        if (fieldset.nextSibling) {
            fieldset.parentNode.insertBefore(panel, fieldset.nextSibling);
        } else {
            fieldset.parentNode.appendChild(panel);
        }

        setupPanelClick(fieldset, panel, quizDoc);
        return panel;
    }

    function actualizarLegend(fieldset, estado, letra) {
        let node = fieldset;
        for (let n = 0; n < 8; n++) {
            node = node.parentElement;
            if (!node || node === document.body) break;
            const siblings = Array.from(node.parentElement?.children || []);
            const nodeIdx = siblings.indexOf(node);
            for (let s = nodeIdx - 1; s >= 0; s--) {
                const h2 = siblings[s].tagName === "H2"
                    ? siblings[s]
                    : siblings[s].querySelector?.("h2.dhdg_2");
                if (h2) {
                    h2.title = estado === "ok"
                        ? "✓ " + letra + " — Click para ver justificación"
                        : "Error — Click para ver detalle";
                    return;
                }
            }
        }
    }

    // —— Imagen ———————————————————————————————————————————————————
    async function extractImageSrc(el) {
        if (!el) return null;
        for (let t = 0; t < 8; t++) {
            const img = el.querySelector("div.d2l-html-block-rendered img") || el.querySelector("img");
            if (img) return img.getAttribute("src");
            await new Promise(r => setTimeout(r, 200));
        }
        return null;
    }

    async function fetchBase64(src) {
        const url = src.startsWith("http") ? src : window.location.origin + src;
        const r = await fetch(url, { credentials: "include" });
        const b = await r.blob();
        return new Promise((res) => {
            const rd = new FileReader();
            rd.onloadend = () => res({ base64: rd.result.split(",")[1], mimeType: b.type });
            rd.readAsDataURL(b);
        });
    }

    // —— Prompt ———————————————————————————————————————————————————
    const SYSTEM_CALCULO = [
        "Eres un profesor universitario experto en FÍSICA MECÁNICA (NC1001 EAFIT — Serway & Jewett 10ª ed.) con 20 años de experiencia.",
        "Tu única tarea: resolver la pregunta dada y justificarla con rigor físico y matemático absoluto.",
        "",
        "⛔ REGLA CRÍTICA #1: LEE LA PREGUNTA QUE TE DAN.",
        "NO inventes un problema diferente. NO asumas datos que no están en el enunciado.",
        "Resuelve EXACTAMENTE la situación descrita en la pregunta, con los datos dados.",
        "Si el problema habla de dos bloques en contacto, resuélvelo así. NO lo conviertas en una polea Atwood.",
        "",
        "⛔ REGLA CRÍTICA #2: RESPONDE TODO EN ESPAÑOL.",
        "Cero inglés. Ni una sola frase en inglés. Si piensas en inglés, traduce SIEMPRE.",
        "",
        "⛔ REGLA CRÍTICA #3: SÉ CONCISO Y DIRECTO.",
        "NO divagues. NO repitas el razonamiento múltiples veces. Calcula UNA vez correctamente.",
        "Si tu resultado coincide con una opción, elige esa opción y termina.",
        "",
        "TEMAS CLAVE (g = 9.8 m/s² siempre):",
        "- ΣF = ma por eje. Fricción: f_s ≤ μ_s·N, f_k = μ_k·N.",
        "- Fuerza a ángulo modifica Normal: N = mg ∓ F·sin(θ).",
        "- Atwood: misma T, misma |a|. Poleas sin masa: T = Mg/n (n = segmentos que soportan la carga).",
        "- Péndulo en posición baja: T > mg siempre. Circular: ΣF_c = mv²/r.",
        "- Momento lineal: conservación si ΣF_ext = 0. p_inicial = p_final.",
        "- W = F·d·cos(θ). W_N = 0. Trabajo-energía: W_neto = ΔK.",
        "- Con fricción: K_i + U_i = K_f + U_f + W_f. W_f = f_k·d = μ_k·N·d (siempre suma positiva que resta energía útil).",
        "- Sin fricción: K_i + U_i = K_f + U_f.",
        "- Inelástica: momento conservado, KE no. Elástica: ambos conservados.",
        "- KE = ½mv². Resorte: U = ½kx².",
        "- Sistemas multi-bloque con F horizontal: a = F_ext_neta/(m1+m2). Fuerza de contacto sobre m2 = m2·a + f_k2 (incluir fricción del bloque 2).",
        "- Dos bloques en contacto empujados: fricción total = μ_k·(m1+m2)·g. a = (F - f_total)/(m1+m2).",
        "",
        "⚠️⚠️ ATWOOD CON TRABAJO-ENERGÍA Y FRICCIÓN — REGLAS ABSOLUTAS (problema frecuente en este examen):",
        "Situación: m₁ horizontal con fricción, m₂ cuelga, unidos por cuerda. m₂ cae h y choca con el piso, luego m₁ sigue deslizando d_extra más.",
        "TRAMO A→B (sistema completo, ambos se mueven h):",
        "  · Energía potencial: SOLO m₂ cae → ΔU = m₂·g·h (NO uses (m₁+m₂)·g·h, m₁ está en horizontal).",
        "  · Fricción sobre m₁: W_f = μ_k·m₁·g·h.",
        "  · Ecuación: ½(m₁+m₂)·v_B² = m₂·g·h − μ_k·m₁·g·h ... (1)",
        "TRAMO B→C (solo m₁ se mueve d_extra):",
        "  · m₂ CHOCÓ con el piso y SE DETUVO. La cuerda se afloja.",
        "  · KE en B es SOLO de m₁: ½m₁·v_B² (NO ½(m₁+m₂)·v_B²).",
        "  · Ecuación: ½m₁·v_B² = μ_k·m₁·g·d_extra ... (2)",
        "COMBINANDO: de (2) → v_B² = 2·μ_k·g·d_extra. Sustituir en (1):",
        "  ½(m₁+m₂)·2·μ_k·g·d_extra = m₂·g·h − μ_k·m₁·g·h",
        "  μ_k·[(m₁+m₂)·d_extra + m₁·h] = m₂·h",
        "  μ_k = m₂·h / [(m₁+m₂)·d_extra + m₁·h]",
        "EJEMPLO: m₁=19, m₂=10, h=2, d_extra=0.5 → μ_k = 20/[29·0.5+19·2] = 20/52.5 = 0.38.",
        "",
        "⚠️  PROBLEMAS DE CÁLCULO NUMÉRICO MULTI-PASO — PROTOCOLO OBLIGATORIO:",
        "Estos problemas (los más difíciles, 30 pts) combinan 2-3 principios. Las opciones son cercanas.",
        "Un error aritmético cambia la respuesta. Sigue este protocolo sin saltarte ningún paso:",
        "",
        "PASO 1 — TRAMOS: identifica y lista cada tramo o subsistema del problema DADO (no de otro problema).",
        "PASO 2 — DATOS: extrae TODOS los valores numéricos con unidades DEL ENUNCIADO. No omitas ninguno.",
        "PASO 3 — ECUACIONES POR TRAMO: plantea la ecuación de cada tramo por separado.",
        "  · Tramo curvo h=R (cuarto de círculo): mgh = ½mv²_B + W_f_curva.",
        "  · Tramo recto hasta el reposo: ½mv²_B = μ_k·m·g·d.",
        "  · Polea compuesta: cuenta segmentos n que soportan la masa → T = Mg/n.",
        "  · Multi-bloque con contacto: Newton al sistema completo → a. Luego Newton a un bloque para fuerza interna.",
        "  · Atwood+fricción: usa las fórmulas de la sección ATWOOD arriba.",
        "PASO 4 — DESPEJAR: aísla la incógnita algebraicamente antes de sustituir.",
        "PASO 5 — CALCULAR: sustituye todos los valores y opera paso a paso. Muestra cada número.",
        "PASO 6 — COMPARAR: escribe el valor numérico obtenido y compáralo contra cada opción.",
        "PASO 7 — VERIFICAR sentido físico (μk entre 0 y 1, tensiones > 0, velocidades positivas).",
        "",
        "⛔ SI OBTIENES UN RESULTADO NEGATIVO O IMPOSIBLE: tus ECUACIONES están mal. NO manipules signos para forzar un resultado. Revisa qué masa aporta PE y qué masa tiene KE en cada tramo.",
        "",
        "ERRORES COMUNES A EVITAR:",
        "- INVENTAR un problema diferente al que te preguntan.",
        "- En Atwood+energía: usar (m₁+m₂)·g·h para la PE cuando SOLO m₂ cae. La PE es m₂·g·h.",
        "- En Atwood+energía: usar ½(m₁+m₂)·v² después del impacto cuando SOLO m₁ sigue moviéndose. La KE después del impacto es ½m₁·v².",
        "- Olvidar la fricción en uno de los tramos.",
        "- Usar h ≠ R en trayectorias de cuarto de círculo.",
        "- Confundir μ_s con μ_k.",
        "- Contar mal los segmentos de cuerda en sistemas de poleas.",
        "- No separar la fuerza de contacto del sistema completo.",
        "",
        "REGLAS: Todo en español. LaTeX: $...$ inline, $$...$$ display.",
        "PREGUNTAS CONCEPTUALES NEGATIVAS: evalúa CADA opción y busca el ÚNICO error.",
        "",
        "ÚLTIMA LÍNEA OBLIGATORIA (sin excepción, siempre al final):",
        "RESPUESTA: X"
    ].join(nl);

    // —— Extracción de letra ——————————————————————————————————————
    function extraerLetra(raw) {
        const clean = stripThinking(raw);
        const m1 = clean.match(/RESPUESTA\s*:\s*([A-E])/i);
        if (m1) return m1[1].toUpperCase();
        const lines = clean.split(/[\r\n]+/);
        const sepIdx = lines.map(l => l.trim()).lastIndexOf("---");
        if (sepIdx !== -1) {
            const after = lines.slice(sepIdx + 1).map(l => l.trim()).filter(l => l);
            if (after.length && /^[A-E]$/.test(after[0])) return after[0];
        }
        for (let i = lines.length - 1; i >= 0; i--) {
            if (/^[A-E]$/.test(lines[i].trim())) return lines[i].trim();
        }
        const m2 = clean.slice(-300).match(/(?:respuesta|opci[oó]n|letra)[^A-Za-z]*([A-E])(?:[^A-Za-z]|$)/i);
        if (m2) return m2[1].toUpperCase();
        return "A";
    }

    // —— API ——————————————————————————————————————————————————————
    function detectarModeloPRO(enunciado) {
        const lower = (enunciado || "").toLowerCase();
        return KEYWORDS_PRO.some(k => lower.includes(k));
    }

    async function preguntarAI(enunciado, opciones, imagen) {
        const optsStr = opciones.map(o => o.letra + ") " + (o.htmlRaw || o.texto)).join(nl);
        const esPRO = detectarModeloPRO(enunciado);
        const model = imagen ? MODEL_VISION : (esPRO ? MODEL_PRO : MODEL_TEXTO);
        console.log("[Solver Física] Modelo seleccionado:", model, esPRO ? "(PRO)" : "(estándar)");

        const construirPayload = (m) => {
            const isQwen = m.includes("qwen");
            const userContent = (isQwen ? "/no_think\n\n" : "") +
                "Lee cuidadosamente la siguiente pregunta. Resuelve EXACTAMENTE este problema, no otro.\n\n" +
                "PREGUNTA:\n" + enunciado + nl + nl + "OPCIONES:\n" + optsStr;
            const p = {
                model: m,
                messages: [
                    { role: "system", content: SYSTEM_CALCULO },
                    { role: "user", content: userContent }
                ],
                max_tokens: esPRO ? 4000 : 3000, temperature: 0.1
            };
            if (imagen) {
                p.max_tokens = 3000;
                p.messages[1].content = [
                    { type: "text", text: "Analiza la imagen y el enunciado. Resuelve EXACTAMENTE este problema.\nENUNCIADO:\n" + enunciado + nl + nl + "OPCIONES:\n" + optsStr },
                    { type: "image_url", image_url: { url: "data:" + imagen.mimeType + ";base64," + imagen.base64 } }
                ];
            }
            return p;
        };

        const hacerPeticion = async (m) => {
            for (let i = 0; i < GROQ_KEYS.length * 3; i++) {
                const key = GROQ_KEYS[currentKeyIndex];
                try {
                    const r = await fetch(GROQ_URL, {
                        method: "POST",
                        headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json" },
                        body: JSON.stringify(construirPayload(m))
                    });
                    if (r.status === 429) {
                        const txt = await r.text();
                        const match = txt.match(/try again in ([\d.]+)s/);
                        const w = match ? Math.ceil(parseFloat(match[1])) + 2 : 20;
                        currentKeyIndex = (currentKeyIndex + 1) % GROQ_KEYS.length;
                        setStatus("yellow");
                        console.log("[Solver Física] Rate limit — esperando " + w + "s...");
                        await new Promise(res => setTimeout(res, w * 1000));
                        setStatus("green");
                        continue;
                    }
                    if (r.status === 413) throw new Error("Payload too large");
                    if (!r.ok) throw new Error("API Error " + r.status);
                    const data = await r.json();
                    if (!data?.choices?.[0]?.message?.content) throw new Error("Respuesta vacía");
                    return data;
                } catch (err) {
                    if (err.message.includes("413")) throw err;
                    if (i === GROQ_KEYS.length * 3 - 1) throw err;
                    currentKeyIndex = (currentKeyIndex + 1) % GROQ_KEYS.length;
                    setStatus("yellow");
                    await new Promise(res => setTimeout(res, 2000));
                }
            }
            throw new Error("Sin intentos");
        };

        let data;
        try { data = await hacerPeticion(model); }
        catch (e) {
            console.warn("[Solver Física] Usando backup...");
            setStatus("yellow");
            data = await hacerPeticion(MODEL_BACKUP);
        }

        const raw = data.choices[0].message.content;
        const letra = extraerLetra(raw);
        const justificacion = stripThinking(raw).replace(/\nRESPUESTA\s*:\s*[A-E]\s*$/i, "").trim();
        return { letra, justificacion };
    }

    function marcar(p, letra) {
        const idx = "ABCDE".indexOf(letra);
        if (p.tipo === "parcial") {
            p.elemento.querySelectorAll("tr.d2l-rowshadeonhover input[type=radio]")[idx]?.click();
        } else {
            p.opts[idx]?.row.querySelector("input[type=radio]")?.click();
        }
    }

    // —— MAIN —————————————————————————————————————————————————————
    const quizDoc = getQuizDoc();
    await cargarKaTeX(quizDoc);

    function buscarEnunciado(fs) {
        let prev = fs.previousElementSibling;
        while (prev) {
            if (prev.tagName.toLowerCase() === "d2l-html-block") return prev;
            const inner = prev.querySelector("d2l-html-block");
            if (inner && !prev.querySelector("input[type=radio]")) return inner;
            prev = prev.previousElementSibling;
        }
        return null;
    }

    const questions = [];
    quizDoc.querySelectorAll("fieldset.dfs_m").forEach(fs => {
        const opts = [];
        fs.querySelectorAll("tr.d2l-rowshadeonhover").forEach((r, i) => {
            const b = r.querySelector("d2l-html-block");
            opts.push({
                row: r, letra: "ABCDE"[i],
                texto: htmlToText(b?.getAttribute("html")),
                htmlRaw: b?.getAttribute("html") || ""
            });
        });
        questions.push({ tipo: "parcial", elemento: fs, opts, b: buscarEnunciado(fs) });
    });

    if (questions.length === 0) {
        quizDoc.querySelectorAll(".d2l-quiz-question-autosave-container").forEach(c => {
            const allBlocks = Array.from(c.querySelectorAll("d2l-html-block"));
            const b = allBlocks.find(block => !block.closest("tr")?.querySelector("input[type=radio]"));
            const opts = [];
            c.querySelectorAll("tr").forEach(r => {
                const radio = r.querySelector("input[type=radio]");
                const block = r.querySelector("d2l-html-block");
                if (radio && block) opts.push({
                    row: r, letra: "ABCDE"[opts.length],
                    texto: htmlToText(block.getAttribute("html")),
                    htmlRaw: block.getAttribute("html") || ""
                });
            });
            questions.push({ tipo: "quiz", elemento: c, opts, b });
        });
    }

    console.log("%c⚡ Física 1 Solver v29 — " + questions.length + " preguntas", "color:#00ff88;font-weight:bold;font-size:13px;");

    for (let i = 0; i < questions.length; i++) {
        const p = questions[i];
        const panel = crearPanel(p.elemento, quizDoc);

        // Indicador por pregunta
        const dot = crearIndicador(p.elemento, quizDoc);
        setIndicador(dot, "detect");
        await new Promise(r => setTimeout(r, 80));
        setIndicador(dot, "loading");

        try {
            const enunciado = htmlToText(p.b?.getAttribute("html") || "");
            const src = await extractImageSrc(p.b)
                || await extractImageSrc(p.b?.parentElement)
                || await extractImageSrc(p.elemento.parentElement);
            const img = src ? await fetchBase64(src) : null;

            console.log("[Física P" + (i + 1) + "] Enunciado:", enunciado.slice(0, 100));
            console.log("[Física P" + (i + 1) + "] Opciones:", p.opts.map(o => o.letra + ": " + o.texto.slice(0, 50)));

            const res = await preguntarAI(enunciado, p.opts, img);

            // Indicador: respondido
            setIndicador(dot, "done");

            panel.innerHTML = [
                "<div style='font-size:13px;line-height:1.9;'>",
                prepararHTML(res.justificacion),
                "</div>",
                "<div style='margin-top:10px;padding-top:8px;border-top:1px solid #e2e8f0;font-size:15px;font-weight:700;color:#16a34a;'>",
                "✓ RESPUESTA: " + res.letra,
                "</div>"
            ].join("");

            renderKaTeX(panel, quizDoc);
            setTimeout(() => renderKaTeX(panel, quizDoc), 300);
            setTimeout(() => renderKaTeX(panel, quizDoc), 1000);

            actualizarLegend(p.elemento, "ok", res.letra);
            marcar(p, res.letra);
            console.log("%c✅ P" + (i + 1) + " → " + res.letra, "color:lime;font-weight:bold;");

            if (i < questions.length - 1) {
                const delay = 12000 + Math.random() * 8000;
                console.log("[Solver Física] Esperando " + Math.round(delay / 1000) + "s...");
                await new Promise(r => setTimeout(r, delay));
            }
        } catch (e) {
            setIndicador(dot, "error");
            panel.innerHTML = "<span style='color:#dc2626;'>❌ Error: " + e.message + "</span>";
            actualizarLegend(p.elemento, "error", "");
            console.error("Error en P" + (i + 1), e);
        }
    }

    console.log("%c✅ Solver v29 completado.", "color:lime;font-weight:bold;font-size:14px;");
})();