(async () => {
    if (window.__solverActivo) { console.warn("[Solver] Ya está corriendo, ignorando."); return; }
    window.__solverActivo = true;

    // ========================================================================
    // D2L GROQ SOLVER - CÁLCULO II (CM0231 EAFIT)
    // ========================================================================

    const GROQ_KEYS = ["DEPLOY_REPLACE_ME"];
    let currentKeyIndex = 0;
    const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

    const MODEL_TEXTO = "qwen/qwen3-32b";
    const MODEL_VISION = "meta-llama/llama-4-scout-17b-16e-instruct";
    const MODEL_BACKUP = "moonshotai/kimi-k2-instruct-0905";

    const nl = String.fromCharCode(10);
    const slash = String.fromCharCode(92);

    window.__groq__ = window.__groq__ || { visible: false, justificaciones: [], preguntas: [] };
    window.__groq__.justificaciones = [];
    window.__groq__.preguntas = [];

    if (window.__groq_toggle_fn__) {
        window.removeEventListener("keydown", window.__groq_toggle_fn__);
        try {
            const i1 = document.getElementById("ctl_2");
            const d = i1?.contentDocument || document;
            d.removeEventListener("keydown", window.__groq_toggle_fn__);
            const i2 = d.querySelector("iframe#FRM_page") || d.querySelector("iframe[name='pageFrame']");
            i2?.contentWindow?.removeEventListener("keydown", window.__groq_toggle_fn__);
        } catch (e) { }
    }
    if (window.__groq_observer__) {
        window.__groq_observer__.disconnect();
    }

    window.__groq_observer__ = new IntersectionObserver((entries) => {
        entries.forEach(e => {
            const div = e.target.__groq_div;
            if (!div) return;
            div.dataset.onScreen = e.isIntersecting ? "true" : "false";
            div.style.display = (window.__groq__.visible && e.isIntersecting) ? "block" : "none";
        });
    }, { threshold: 0.1 });

    // —— Procesamiento de Texto ————————————————————————————————————
    function filtrarLineasExplicativas(cuerpo) {
        const lineas = cuerpo.split(nl);
        const filtradas = lineas.filter(l => {
            const t = l.trim();
            if (t.length === 0) return true;
            if (t.startsWith("Tema:") || t.startsWith("Procedimiento:") || t.startsWith("Resultado:") || t.startsWith("Verificación:")) return true;
            if (t.includes("$") || t.includes(slash) || t.includes("=")) return true;
            return false;
        });
        return filtradas.join(nl);
    }

    function limpiarRespuestaModelo(raw) {
        const separatorRegex = new RegExp("---+");
        const partes = raw.split(separatorRegex);
        const letraSeccion = partes[partes.length - 1].trim();
        let cuerpo = partes.length >= 2
            ? partes.slice(0, -1).join("---").trim()
            : raw.trim();
        cuerpo = filtrarLineasExplicativas(cuerpo);
        return { justificacion: cuerpo, letraSeccion };
    }

    function prepararHTML(texto) {
        texto = texto
            .split(slash + "(").join("$").split(slash + ")").join("$")
            .split(slash + "[").join("$$").split(slash + "]").join("$$");

        texto = texto.replace(new RegExp("\\$\\$([\\s\\S]*?)\\$\\$", "g"), (m, p1) => {
            let formula = p1.trim().replace(new RegExp("^[\\s]*" + slash + "displaystyle"), "").trim();
            const url = "https://latex.codecogs.com/svg.latex?" + slash + "displaystyle&space;" + encodeURIComponent(formula);
            return "<div style='text-align:center;margin:4px 0;'><img src='" + url + "' alt='math' style='max-width:100%;'></div>";
        });
        texto = texto.replace(new RegExp("\\$([^\\$]+)\\$", "g"), (m, p1) => {
            const url = "https://latex.codecogs.com/svg.latex?" + slash + "inline&space;" + encodeURIComponent(p1.trim());
            return "<img src='" + url + "' alt='math' style='transform:translateY(3px);max-width:100%;'>";
        });

        return texto.split(nl).map(l => {
            return l.replace(new RegExp("[*][*]([^*]+)[*][*]", "g"), "<strong>$1</strong>");
        }).join("<br>");
    }

    // —— UI ———————————————————————————————————————————————————————
    function crearDivJustificacion(p) {
        const el = document.createElement("div");
        el.className = "__groq_justification_div";
        el.style.cssText = "display:none;width:100%;max-height:80px;overflow-y:auto;background:transparent;border-top:1px solid rgba(0,0,0,0.07);font-size:11px;padding:4px 0;margin-bottom:8px;font-family:system-ui,sans-serif;color:#333;line-height:1.4;";
        const target = p.elemento;
        if (target.nextSibling) {
            target.parentElement.insertBefore(el, target.nextSibling);
        } else {
            target.parentElement.appendChild(el);
        }
        p.elemento.__groq_div = el;
        window.__groq_observer__.observe(p.elemento);
        return el;
    }

    function actualizarVisibilidad() {
        document.querySelectorAll(".__groq_justification_div").forEach(d => {
            const onScreen = d.dataset.onScreen === "true";
            d.style.display = (window.__groq__.visible && onScreen) ? "block" : "none";
        });
    }

    const toggleX = (e) => {
        if (e.key.toLowerCase() !== 'x') return;
        const now = Date.now();
        if (window.__groq_last_t && now - window.__groq_last_t < 300) return;
        window.__groq_last_t = now;
        window.__groq__.visible = !window.__groq__.visible;
        actualizarVisibilidad();
    };
    window.__groq_toggle_fn__ = toggleX;
    window.addEventListener("keydown", toggleX);
    try {
        const i1 = document.getElementById("ctl_2");
        const d = i1?.contentDocument || document;
        d.addEventListener("keydown", toggleX);
        const i2 = d.querySelector("iframe#FRM_page") || d.querySelector("iframe[name='pageFrame']");
        i2?.contentWindow?.addEventListener("keydown", toggleX);
    } catch (e) { }

    // —— DOM Utils ——————————————————————————————————————————————
    function htmlToText(html) {
        if (!html) return "";
        const d = document.createElement("div");
        d.innerHTML = html.replace(new RegExp("&nbsp;", "g"), " ");
        let t = d.textContent || d.innerText || "";
        return t.split(new RegExp("[\\r\\n\\t]+", "g")).join(" ").split(new RegExp(" {2,}", "g")).join(" ").trim();
    }

    async function extractImageSrc(el) {
        if (!el) return null;
        for (let t = 0; t < 10; t++) {
            const rend = el.querySelector("div.d2l-html-block-rendered img");
            if (rend) return rend.getAttribute("src");
            await new Promise(r => setTimeout(r, 200));
        }
        return el.querySelector("img")?.getAttribute("src");
    }

    async function fetchBase64(src) {
        const url = src.startsWith("http") ? src : window.location.origin + src;
        const r = await fetch(url, { credentials: "include" });
        const b = await r.blob();
        return new Promise((res, rej) => {
            const rd = new FileReader();
            rd.onloadend = () => res({ base64: rd.result.split(",")[1], mimeType: b.type });
            rd.readAsDataURL(b);
        });
    }

    // —— Prompt Cálculo II ————————————————————————————————————————
    const SYSTEM_CALCULO = [
        "Eres un matemático experto resolviendo parciales de Cálculo II, estrictamente apegado al texto de Stewart 8a edición. Tu precisión matemática es infalible.",
        "ESTO ES CÁLCULO PURO, NO ESTADÍSTICA. No estás buscando funciones de densidad de probabilidad (PDF), estás buscando ÁREAS GEOMÉTRICAS literales.",
        "",
        "TEMAS DEL CURSO:",
        "- Áreas, integral definida, TFC, antiderivadas, cambio neto (§4.9, 5.1-5.4)",
        "- Técnicas: Sustitución, partes, fracciones parciales, sustitución trigonométrica (§5.5, 7.1-7.4)",
        "- Aplicaciones: Área entre curvas, volúmenes (discos/arandelas, cascarones), trabajo, valor promedio (§6.1-6.5)",
        "- Aplicaciones avanzadas: Longitud de arco, superficie de revolución (§8.1-8.2)",
        "- Física: Fuerza hidrostática, centros de masa (§8.3-8.5)",
        "- Integrales impropias (§7.8)",
        "- Sucesiones, series, convergencia, Taylor/Maclaurin (§11.1-11.11)",
        "",
        "REGLAS SUPREMAS:",
        "1. EL OBJETIVO DETERMINA EL PROCEDIMIENTO: MIRA LAS OPCIONES ANTES de operar a ciegas. ¿Las opciones son valores numéricos decimales? Resuelve hasta el final. ¿Las opciones son INTEGRALES SIN RESOLVER (fórmulas)? Entonces TU ÚNICO TRABAJO ES PLANTEAR, NO LA RESUELVAS.",
        "2. PLANTEAMIENTOS DE ÁREA (CÁLCULO PURO, NO ESTADÍSTICA): El área geométrica bajo la curva $f(x)$ es estrictamente $\\int_a^b f(x) dx$. NUNCA multipliques la función por derivadas internas ni agregues coeficientes 0.5 o constantes mágicas para fabricar un 'área=1' (no confundas cálculo con distribuciones exponenciales de probabilidad). Calca la función literalmente en la integral.",
        "3. NO INVENTES problemas. Si te dan una gráfica o enunciado en una imagen, esa es la verdad absoluta. Si el texto falla, confía en la imagen.",
        "4. JAMÁS DIGAS 'Ninguna opción coincide'. Si tu resultado preliminar no se ve igual a las opciones, APLICA ÁLGEBRA o cambia la variable para empatar lógicamente con una de las opciones.",
        "5. Superficie de Revolución:",
        "   - Giro eje Y: El radio es $x$ (o $g(y)$). Área $dA = 2\\pi x \\, ds$.",
        "   - Giro eje X: El radio es $y$ (o $f(x)$). Área $dA = 2\\pi y \\, ds$.",
        "   - ¡Cuidado con sustituciones $u$! Si $u=e^x$, los límites también cambian.",
        "6. Tópicos Avanzados (MUY IMPORTANTE):",
        "   - Integrales Impropias: ¡ALERTA DE SIGNOS! Analiza algebraicamente a dónde tiende el exponente. Ej: $e^{-(-\\infty)} = e^{\\infty} = \\infty$ (DIVERGE).",
        "   - Series y Convergencia: Declara EXACTAMENTE qué prueba estás usando y demuéstrala.",
        "   - Polinomios de Taylor: Asegúrate de revisar alrededor de qué centro $a$ está calculado.",
        "7. CUIDADO CON PREGUNTAS NEGATIVAS: Si el enunciado dice 'NO corresponde', 'FALSA', o 'INCORRECTA', tu objetivo se INVIERTE. Debes evaluar todas las opciones y encontrar la ÚNICA que tiene un ERROR matemático (ej. un signo menos faltante, un límite mal evaluado). Tres serán correctas, una será un error explícito. ¡Atrapa la que está MAL!",
        "8. ESTRICTAMENTE PROCEDIMIENTOS. No uses relleno de texto.",
        "",
        "ESTRUCTURA INQUEBRANTABLE:",
        "Tema: (Concepto teórico evaluado)",
        "Procedimiento: (Paso 1: Planteamiento de la base teórica. Paso 2: Derivación y cuadrados. Paso 3: Aplicación de cambios de variable para forzar el empate lógico con las opciones. Usa exclusivamente código LaTeX conectado por iguales.)",
        "Resultado: (Formulación final numérica o integral sin resolver)",
        "Verificación: (Demostración rigurosa de por qué una de las opciones es un espejo exacto del Resultado)",
        "---",
        "LETRA",
        "(La última línea obligatoriamente tiene SOLO UNA LETRA que indique la opción verdadera: A, B, C, D o E)"
    ].join(nl);

    // —— API con rotación de keys ————————————————————————————————
    async function preguntarAI(enunciado, opciones, imagen) {
        const optsStr = opciones.map(o => o.letra + ") " + o.texto).join(nl);
        const model = imagen ? MODEL_VISION : MODEL_TEXTO;

        const construirPayload = (modeloParam) => {
            const p = {
                model: modeloParam,
                messages: [
                    { role: "system", content: SYSTEM_CALCULO },
                    { role: "user", content: "Analiza exhaustivamente la pregunta y determina el enunciado real.\nPREGUNTA:\n" + enunciado + nl + nl + "OPCIONES:\n" + optsStr }
                ],
                max_tokens: imagen ? 4096 : 8000,
                temperature: 0.1
            };
            if (imagen) {
                p.messages[1].content = [
                    { type: "text", text: "Lee el enunciado y analiza cuidadosamente la imagen, la cual contiene la fórmula o gráfica vital de la pregunta. Responde a lo que se te pide en base a esa imagen.\n\nENUNCIADO:\n" + enunciado + nl + nl + "OPCIONES:\n" + optsStr },
                    { type: "image_url", image_url: { url: "data:" + imagen.mimeType + ";base64," + imagen.base64 } }
                ];
            }
            return p;
        };

        const hacerPeticion = async (modeloParam) => {
            for (let i = 0; i < GROQ_KEYS.length * 3; i++) {
                const key = GROQ_KEYS[currentKeyIndex];
                try {
                    const r = await fetch(GROQ_URL, {
                        method: "POST",
                        headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json" },
                        body: JSON.stringify(construirPayload(modeloParam))
                    });
                    if (r.status === 429) {
                        currentKeyIndex = (currentKeyIndex + 1) % GROQ_KEYS.length;
                        const wait = 25 + i * 15;
                        console.log("[Solver] Rate limit — rotando key, esperando " + wait + "s...");
                        await new Promise(res => setTimeout(res, wait * 1000));
                        continue;
                    }
                    if (!r.ok) throw new Error("Groq API Error: " + r.status);
                    return await r.json();
                } catch (err) {
                    if (i === GROQ_KEYS.length * 3 - 1) throw err;
                    currentKeyIndex = (currentKeyIndex + 1) % GROQ_KEYS.length;
                    await new Promise(res => setTimeout(res, 2000));
                }
            }
        };

        let data;
        try {
            data = await hacerPeticion(model);
        } catch (e) {
            console.warn("[Solver] Kimi falló, usando Qwen como fallback...");
            data = await hacerPeticion(MODEL_BACKUP);
        }

        const raw = data.choices[0].message.content;
        const res = limpiarRespuestaModelo(raw);

        // Extracción robusta de letra — cascada de 4 métodos
        let letra = null;
        const rawLines = raw.split(new RegExp("[\r\n]+"));
        const sepIdx = rawLines.map(l => l.trim()).lastIndexOf("---");
        if (sepIdx !== -1 && sepIdx < rawLines.length - 1) {
            const afterSep = rawLines.slice(sepIdx + 1).map(l => l.trim()).filter(l => l.length > 0);
            if (afterSep.length > 0 && new RegExp("^[A-E]$").test(afterSep[0])) {
                letra = afterSep[0].toUpperCase();
            }
        }
        if (!letra) {
            const m = res.letraSeccion.toUpperCase().match(new RegExp("^[\\s]*([A-E])[\\s]*$"));
            if (m) letra = m[1];
        }
        if (!letra) {
            const tail = raw.slice(-300);
            const m = tail.match(new RegExp("(?:respuesta|opci[oó]n|letra)[^A-Za-z]*([A-E])(?:[^A-Za-z]|$)", "i"));
            if (m) letra = m[1].toUpperCase();
        }
        if (!letra) {
            for (let li = rawLines.length - 1; li >= 0; li--) {
                const l = rawLines[li].trim();
                if (new RegExp("^[A-E]$").test(l)) { letra = l; break; }
            }
        }
        if (!letra) letra = "A";

        return { letra, justificacion: res.justificacion };
    }

    function marcar(p, letra) {
        const idx = "ABCDE".indexOf(letra);
        if (p.tipo === "parcial") {
            const inputs = p.elemento.querySelectorAll("tr.d2l-rowshadeonhover input[type=radio]");
            inputs[idx]?.click();
        } else {
            const input = p.opts[idx]?.row.querySelector("input[type=radio]");
            input?.click();
        }
    }

    // —— Motor Principal ————————————————————————————————————————
    const doc = (() => {
        try {
            const i1 = document.getElementById("ctl_2");
            const d = i1?.contentDocument || document;
            const i2 = d.querySelector("iframe#FRM_page") || d.querySelector("iframe[name='pageFrame']");
            return i2?.contentDocument || d;
        } catch (e) { return document; }
    })();

    function buscarEnunciado(elemento) {
        let prev = elemento.previousElementSibling;
        while (prev) {
            if (prev.tagName.toLowerCase() === "d2l-html-block") return prev;
            const inner = prev.querySelector("d2l-html-block");
            if (inner && !prev.querySelector("input[type=radio]")) return inner;
            prev = prev.previousElementSibling;
        }
        return null;
    }

    const questions = [];
    doc.querySelectorAll("fieldset.dfs_m").forEach(fs => {
        const opts = [];
        fs.querySelectorAll("tr.d2l-rowshadeonhover").forEach((r, i) => {
            const b = r.querySelector("d2l-html-block");
            opts.push({ row: r, letra: "ABCDE"[i], texto: htmlToText(b?.getAttribute("html")) });
        });
        const b = buscarEnunciado(fs);
        questions.push({ tipo: "parcial", elemento: fs, opts, b });
    });

    if (questions.length === 0) {
        doc.querySelectorAll(".d2l-quiz-question-autosave-container").forEach(c => {
            const allBlocks = Array.from(c.querySelectorAll("d2l-html-block"));
            const b = allBlocks.find(block => {
                const tr = block.closest("tr");
                return !tr || !tr.querySelector("input[type=radio]");
            });
            const opts = [];
            c.querySelectorAll("tr").forEach((r) => {
                const radio = r.querySelector("input[type=radio]");
                const block = r.querySelector("d2l-html-block");
                if (radio && block) opts.push({ row: r, letra: "ABCDE"[opts.length], texto: htmlToText(block.getAttribute("html")) });
            });
            questions.push({ tipo: "quiz", elemento: c, opts, b });
        });
    }

    console.log("%c⚡ Cálculo II Solver — " + questions.length + " preguntas | Kimi K2 + Qwen backup", "color:cyan;font-weight:bold;font-size:13px;");

    for (let i = 0; i < questions.length; i++) {
        const p = questions[i];
        const div = crearDivJustificacion(p);
        div.innerHTML = "<em>⏳ Resolviendo pregunta " + (i + 1) + "/" + questions.length + "...</em>";
        if (window.__groq__.visible) div.style.display = "block";

        try {
            const enunciado = htmlToText(p.b?.getAttribute("html") || "");
            const src = await extractImageSrc(p.b);
            const img = src ? await fetchBase64(src) : null;

            console.log("[P" + (i + 1) + "] Enunciado:", enunciado.slice(0, 100));
            console.log("[P" + (i + 1) + "] Opciones:", p.opts.map(o => o.letra + ": " + o.texto.slice(0, 60)));

            const res = await preguntarAI(enunciado, p.opts, img);

            div.innerHTML = "<div>" + prepararHTML(res.justificacion) + "</div>" +
                "<div style='color:#16a34a;font-weight:bold;margin-top:8px;font-size:12px;'>✓ Letra: " + res.letra + "</div>";

            marcar(p, res.letra);
            console.log("%c✅ P" + (i + 1) + " → " + res.letra, "color:lime;font-weight:bold;");

            if (i < questions.length - 1) {
                const delay = 12000 + Math.random() * 8000;
                console.log("[Solver] Esperando " + Math.round(delay / 1000) + "s...");
                await new Promise(r => setTimeout(r, delay));
            }
        } catch (e) {
            div.innerHTML = "<span style='color:#dc2626'>❌ Error: " + e.message + "</span>";
            console.error("Error en P" + (i + 1), e);
        }
    }

    console.log("%c✅ Solver completado.", "color:lime;font-weight:bold;font-size:14px;");
})();