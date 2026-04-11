(async () => {
    if (window.__solverActivo) { console.warn("[Solver] Ya está corriendo, ignorando."); return; }
    window.__solverActivo = true;

    // ========================================================================
    // D2L GROQ SOLVER v27 - CÁLCULO II (CM0231 EAFIT)
    // - KaTeX nativo (no codecogs)
    // - Click en pregunta para ver justificación
    // - Círculo de estado: verde/amarillo/rojo
    // ========================================================================

    const GROQ_KEYS = ["DEPLOY_REPLACE_ME"];
    let currentKeyIndex = 0;
    const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

    const MODEL_TEXTO = "qwen/qwen3-32b";
    const MODEL_VISION = "meta-llama/llama-4-scout-17b-16e-instruct";
    const MODEL_BACKUP = "moonshotai/kimi-k2-instruct-0905";

    const nl = String.fromCharCode(10);
    const slash = String.fromCharCode(92);

    // —— Estado global ————————————————————————————————————————————
    window.__groq__ = window.__groq__ || {};
    window.__groq__.preguntas = [];
    window.__groq__.panelActivo = null;

    // Limpiar toggles viejos
    if (window.__groq_toggle_fn__) {
        window.removeEventListener("keydown", window.__groq_toggle_fn__);
    }

    // —— Círculo de estado ————————————————————————————————————————
    // verde = ok, amarillo = advertencia (rotando key), rojo = error
    const statusDot = document.createElement("div");
    statusDot.style.cssText = "position:fixed;top:6px;left:6px;width:5px;height:5px;border-radius:50%;background:#00ff00;opacity:0.25;z-index:999999;pointer-events:none;transition:background 0.3s;";
    window.top.document.body.appendChild(statusDot); // ← window.top para salir del iframe

    function setStatus(color) {
        // color: 'green' | 'yellow' | 'red'
        const colors = { green: "#00ff00", yellow: "#ffcc00", red: "#ff3333" };
        statusDot.style.background = colors[color] || colors.green;
    }

    // —— KaTeX ————————————————————————————————————————————————————
    async function cargarKaTeX() {
        if (window.katex) return;
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = "https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.css";
        document.head.appendChild(link);
        const loadScript = src => new Promise((res, rej) => {
            const s = document.createElement("script");
            s.src = src; s.onload = res; s.onerror = rej;
            document.head.appendChild(s);
        });
        await loadScript("https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.js");
        await loadScript("https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/contrib/auto-render.min.js");
    }

    function renderKaTeX(el) {
        if (!window.renderMathInElement) return;
        try {
            window.renderMathInElement(el, {
                delimiters: [
                    { left: "$$", right: "$$", display: true },
                    { left: "$", right: "$", display: false },
                    { left: "\\(", right: "\\)", display: false },
                    { left: "\\[", right: "\\]", display: true }
                ],
                throwOnError: false,
                strict: false
            });
        } catch (e) { }
    }

    // —— Procesamiento de texto ————————————————————————————————————
    function stripThinking(raw) {
        return raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    }

    function limpiarRespuestaModelo(raw) {
        const clean = stripThinking(raw);
        // Quitar la línea "RESPUESTA: X" del cuerpo
        const cuerpo = clean.replace(/\nRESPUESTA\s*:\s*[A-E]\s*$/i, "").trim();
        return cuerpo;
    }

    function prepararHTML(texto) {
        // Normalizar delimitadores LaTeX para KaTeX
        texto = texto
            .split("\\(").join("$")
            .split("\\)").join("$")
            .split("\\[").join("$$")
            .split("\\]").join("$$");

        return texto
            .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
            .replace(/\*([^*\n]+)\*/g, "$1")
            .replace(/#{1,6} ?([^\n]+)/g, "<strong>$1</strong>")
            .split("\n").join("<br>");
    }

    // —— UI — Panel de justificación por pregunta ——————————————————
    function cerrarPanelActivo() {
        if (window.__groq__.panelActivo) {
            window.__groq__.panelActivo.style.display = "none";
            window.__groq__.panelActivo = null;
        }
    }

    function crearPanelJustificacion(preguntaEl) {
        const panel = document.createElement("div");
        panel.className = "__groq_panel__";
        panel.style.cssText = [
            "display:none",
            "width:100%",
            "max-height:220px",
            "overflow-y:auto",
            "background:rgba(255,255,255,0.97)",
            "border:1px solid rgba(0,0,0,0.1)",
            "border-radius:6px",
            "padding:12px 14px",
            "margin:8px 0 12px 0",
            "font-family:'Segoe UI',system-ui,sans-serif",
            "font-size:13px",
            "line-height:1.8",
            "color:#1a1a1a",
            "box-shadow:0 2px 8px rgba(0,0,0,0.08)",
            "cursor:default"
        ].join(";");

        if (preguntaEl.nextSibling) {
            preguntaEl.parentElement.insertBefore(panel, preguntaEl.nextSibling);
        } else {
            preguntaEl.parentElement.appendChild(panel);
        }
        return panel;
    }

    function crearTituloClickable(preguntaEl, idx, panel) {
        // El legend es el título "Pregunta 1" que aparece arriba
        const legend = preguntaEl.querySelector("legend");
        const target = legend || preguntaEl;
        target.style.cursor = "pointer";
        target.style.userSelect = "none";
        target.addEventListener("click", (e) => {
            if (e.target.tagName === "INPUT" || e.target.tagName === "LABEL") return;
            if (panel.style.display === "none") {
                cerrarPanelActivo();
                panel.style.display = "block";
                window.__groq__.panelActivo = panel;
                setTimeout(() => renderKaTeX(panel), 50);
            } else {
                panel.style.display = "none";
                window.__groq__.panelActivo = null;
            }
        });
        return target;
    }

    function actualizarBoton(btn, estado, letra) {
        if (estado === "ok") {
            btn.title = "✓ " + letra + " — Click para justificación";
            btn.style.color = "#16a34a";
        } else if (estado === "error") {
            btn.title = "Error — Click para detalle";
            btn.style.color = "#dc2626";
        }
    }

    // —— DOM Utils ——————————————————————————————————————————————
    function htmlToText(html) {
        if (!html) return "";
        const d = document.createElement("div");
        d.innerHTML = html.replace(/&nbsp;/g, " ");
        return (d.textContent || d.innerText || "")
            .replace(/[\r\n\t]+/g, " ")
            .replace(/ {2,}/g, " ")
            .trim();
    }

    async function extractImageSrc(el) {
        if (!el) return null;
        for (let t = 0; t < 8; t++) {
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
        "1. EL OBJETIVO DETERMINA EL PROCEDIMIENTO: MIRA LAS OPCIONES ANTES de operar a ciegas.",
        "2. ÁREA GEOMÉTRICA: $\\int_a^b f(x) dx$ — NUNCA multipliques por derivadas internas ni coeficientes mágicos.",
        "3. NO INVENTES problemas. Si hay imagen, esa es la verdad absoluta.",
        "4. JAMÁS DIGAS 'Ninguna opción coincide'. APLICA ÁLGEBRA para empatar.",
        "5. Superficie de Revolución: Giro eje Y: $dA=2\\pi x\\,ds$. Giro eje X: $dA=2\\pi y\\,ds$.",
        "6. Integrales Impropias: ALERTA DE SIGNOS. Analiza a dónde tiende el exponente.",
        "7. Series: Declara EXACTAMENTE qué prueba usas y demuéstrala.",
        "8. PREGUNTAS NEGATIVAS: 'NO corresponde', 'FALSA', 'INCORRECTA' → busca el ÚNICO error matemático entre las opciones. Evalúa CADA opción con cálculo explícito.",
        "",
        "ESTRUCTURA:",
        "Tema: (sección de Stewart)",
        "Procedimiento: (pasos con LaTeX $...$, $$...$$)",
        "Resultado: (valor o expresión final)",
        "Verificación: (por qué coincide con la opción elegida)",
        "",
        "OBLIGATORIO: La última línea de tu respuesta debe ser EXACTAMENTE:",
        "RESPUESTA: X",
        "(donde X es A, B, C, D o E — sin más texto en esa línea)"
    ].join(nl);

    // —— Extracción robusta de letra ——————————————————————————————
    function extraerLetra(raw) {
        const clean = stripThinking(raw);

        // 1. "RESPUESTA: X" — método principal
        const respTag = clean.match(/RESPUESTA\s*:\s*([A-E])/i);
        if (respTag) return respTag[1].toUpperCase();

        // 2. Separador --- seguido de letra sola
        const lines = clean.split(/[\r\n]+/);
        const sepIdx = lines.map(l => l.trim()).lastIndexOf("---");
        if (sepIdx !== -1) {
            const after = lines.slice(sepIdx + 1).map(l => l.trim()).filter(l => l.length > 0);
            if (after.length > 0 && /^[A-E]$/.test(after[0])) return after[0];
        }

        // 3. Última línea exactamente una letra
        for (let i = lines.length - 1; i >= 0; i--) {
            if (/^[A-E]$/.test(lines[i].trim())) return lines[i].trim();
        }

        // 4. Frase explícita
        const m = clean.slice(-300).match(/(?:respuesta|opci[oó]n|letra)[^A-Za-z]*([A-E])(?:[^A-Za-z]|$)/i);
        if (m) return m[1].toUpperCase();

        return "A";
    }

    // —— API con rotación de keys y rate limit inteligente ————————
    async function preguntarAI(enunciado, opciones, imagen) {
        const optsStr = opciones.map(o => o.letra + ") " + (o.htmlRaw || o.texto)).join(nl);
        const model = imagen ? MODEL_VISION : MODEL_TEXTO;

        const construirPayload = (modeloParam) => {
            const p = {
                model: modeloParam,
                messages: [
                    { role: "system", content: SYSTEM_CALCULO },
                    { role: "user", content: "Analiza la pregunta y responde.\nPREGUNTA:\n" + enunciado + nl + nl + "OPCIONES:\n" + optsStr }
                ],
                max_tokens: 3000,
                temperature: 0.1
            };
            if (imagen) {
                p.max_tokens = 2000;
                p.messages[1].content = [
                    { type: "text", text: "Lee el enunciado y analiza la imagen.\n\nENUNCIADO:\n" + enunciado + nl + nl + "OPCIONES:\n" + optsStr },
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
                        const txt = await r.text();
                        const m = txt.match(/try again in ([\d.]+)s/);
                        const w = m ? Math.ceil(parseFloat(m[1])) + 2 : 20;
                        currentKeyIndex = (currentKeyIndex + 1) % GROQ_KEYS.length;
                        setStatus("yellow");
                        console.log("[Solver] Rate limit — rotando key, esperando " + w + "s...");
                        await new Promise(res => setTimeout(res, w * 1000));
                        setStatus("green");
                        continue;
                    }
                    if (r.status === 413) throw new Error("Payload too large (413)");
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
            throw new Error("Se agotaron todos los intentos");
        };

        let data;
        try {
            data = await hacerPeticion(model);
        } catch (e) {
            console.warn("[Solver] Principal falló (" + e.message + "), usando backup...");
            setStatus("yellow");
            data = await hacerPeticion(MODEL_BACKUP);
        }

        const raw = data.choices[0].message.content;
        const letra = extraerLetra(raw);
        const justificacion = limpiarRespuestaModelo(raw);
        return { letra, justificacion };
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
    await cargarKaTeX();

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
            opts.push({
                row: r,
                letra: "ABCDE"[i],
                texto: htmlToText(b?.getAttribute("html")),
                htmlRaw: b?.getAttribute("html") || ""
            });
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
                if (radio && block) opts.push({
                    row: r,
                    letra: "ABCDE"[opts.length],
                    texto: htmlToText(block.getAttribute("html")),
                    htmlRaw: block.getAttribute("html") || ""
                });
            });
            questions.push({ tipo: "quiz", elemento: c, opts, b });
        });
    }

    console.log("%c⚡ Cálculo II Solver v27 — " + questions.length + " preguntas", "color:cyan;font-weight:bold;font-size:13px;");
    setStatus("green");

    for (let i = 0; i < questions.length; i++) {
        const p = questions[i];

        // Crear panel de justificación
        const panel = crearPanelJustificacion(p.elemento);
        const btn = crearTituloClickable(p.elemento, i, panel);

        panel.innerHTML = "<em style='color:#888;font-size:12px;'>⏳ Resolviendo...</em>";

        try {
            const enunciado = htmlToText(p.b?.getAttribute("html") || "");
            const src = await extractImageSrc(p.b);
            const img = src ? await fetchBase64(src) : null;

            console.log("[P" + (i + 1) + "] Enunciado:", enunciado.slice(0, 100));
            console.log("[P" + (i + 1) + "] Opciones (" + p.opts.length + "):", p.opts.map(o => o.letra + ": " + o.texto.slice(0, 50)));

            const res = await preguntarAI(enunciado, p.opts, img);

            // Renderizar justificación con KaTeX
            panel.innerHTML = [
                "<div style='font-size:13px;line-height:1.9;color:#1a1a1a;'>",
                prepararHTML(res.justificacion),
                "</div>",
                "<div style='margin-top:12px;padding-top:8px;border-top:1px solid rgba(0,0,0,0.08);font-size:15px;font-weight:700;color:#16a34a;letter-spacing:2px;'>",
                "✓ RESPUESTA: " + res.letra,
                "</div>"
            ].join("");

            renderKaTeX(panel);
            setTimeout(() => renderKaTeX(panel), 200);
            setTimeout(() => renderKaTeX(panel), 800);

            actualizarBoton(btn, "ok", res.letra);
            marcar(p, res.letra);
            setStatus("green");
            console.log("%c✅ P" + (i + 1) + " → " + res.letra, "color:lime;font-weight:bold;");

            if (i < questions.length - 1) {
                const delay = 12000 + Math.random() * 8000;
                console.log("[Solver] Esperando " + Math.round(delay / 1000) + "s...");
                await new Promise(r => setTimeout(r, delay));
            }
        } catch (e) {
            panel.innerHTML = "<span style='color:#dc2626;font-size:12px;'>❌ Error: " + e.message + "</span>";
            actualizarBoton(btn, "error", "");
            setStatus("red");
            console.error("Error en P" + (i + 1), e);
        }
    }

    console.log("%c✅ Solver v27 completado.", "color:lime;font-weight:bold;font-size:14px;");
})();