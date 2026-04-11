(async () => {
    if (window.__solverActivo) { console.warn("[Solver] Ya está corriendo."); return; }
    window.__solverActivo = true;

    // ========================================================================
    // D2L GROQ SOLVER v28 - CÁLCULO II (CM0231 EAFIT)
    // ========================================================================

    const GROQ_KEYS = ["DEPLOY_REPLACE_ME"];
    let currentKeyIndex = 0;
    const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
    const MODEL_TEXTO = "qwen/qwen3-32b";
    const MODEL_VISION = "meta-llama/llama-4-scout-17b-16e-instruct";
    const MODEL_BACKUP = "moonshotai/kimi-k2-instruct-0905";
    const nl = String.fromCharCode(10);
    const slash = String.fromCharCode(92);

    // —— Círculo de estado — va en window.top para salir de iframes ——
    let statusDot = window.top.document.getElementById("__groq_dot__");
    if (!statusDot) {
        statusDot = window.top.document.createElement("div");
        statusDot.id = "__groq_dot__";
        window.top.document.body.appendChild(statusDot);
    }
    statusDot.style.cssText = "position:fixed;top:8px;left:8px;width:6px;height:6px;border-radius:50%;background:#00cc44;opacity:0.3;z-index:2147483647;pointer-events:none;transition:all 0.4s;";

    function setStatus(s) {
        const c = { green: "#00cc44", yellow: "#ffaa00", red: "#ff3333" };
        statusDot.style.background = c[s] || c.green;
        statusDot.style.opacity = s === "green" ? "0.3" : "0.7";
    }
    setStatus("green");

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
        return texto
            .split("\\(").join("$").split("\\)").join("$")
            .split("\\[").join("$$").split("\\]").join("$$")
            .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
            .split("\n").join("<br>");
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
        const legend = fieldset.querySelector("legend");
        if (!legend) return;

        legend.style.cursor = "pointer";
        legend.style.userSelect = "none";

        // Usar el quizDoc para el evento — así el listener vive en el iframe correcto
        legend.addEventListener("click", function (e) {
            e.stopPropagation();
            // Cerrar otros paneles abiertos
            quizDoc.querySelectorAll(".__groq_panel__").forEach(p => {
                if (p !== panel) p.style.display = "none";
            });
            // Toggle este panel
            const open = panel.style.display === "block";
            panel.style.display = open ? "none" : "block";
            if (!open) {
                setTimeout(() => renderKaTeX(panel, quizDoc), 80);
            }
        });
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
        const legend = fieldset.querySelector("legend");
        if (!legend) return;
        if (estado === "ok") {
            legend.style.color = "#16a34a";
            legend.title = "✓ Respuesta: " + letra + " — Haz click para ver justificación";
        } else {
            legend.style.color = "#dc2626";
            legend.title = "Error al resolver — Click para ver detalle";
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
        "Eres un matemático experto resolviendo parciales de Cálculo II, estrictamente apegado al texto de Stewart 8a edición. Tu precisión matemática es infalible.",
        "ESTO ES CÁLCULO PURO, NO ESTADÍSTICA.",
        "",
        "TEMAS DEL CURSO:",
        "- Áreas, integral definida, TFC, antiderivadas (§4.9, 5.1-5.4)",
        "- Sustitución, partes, fracciones parciales, sustitución trigonométrica (§5.5, 7.1-7.4)",
        "- Área entre curvas, volúmenes (discos/arandelas/cascarones), trabajo, valor promedio (§6.1-6.5)",
        "- Longitud de arco, superficie de revolución (§8.1-8.2)",
        "- Fuerza hidrostática, centros de masa (§8.3-8.5)",
        "- Integrales impropias (§7.8)",
        "- Sucesiones, series, convergencia, Taylor/Maclaurin (§11.1-11.11)",
        "",
        "REGLAS SUPREMAS:",
        "1. MIRA LAS OPCIONES ANTES de operar. Si son fórmulas sin resolver, solo plantea. Si son números, resuelve hasta el final.",
        "2. ÁREA GEOMÉTRICA es $\\int_a^b f(x)dx$ — nunca multipliques por derivadas internas.",
        "3. Si hay imagen, es la verdad absoluta.",
        "4. JAMÁS digas 'Ninguna opción coincide'. Aplica álgebra para empatar.",
        "5. Superficie revolución: eje Y → $2\\pi x\\,ds$, eje X → $2\\pi y\\,ds$.",
        "6. Integrales impropias: ALERTA DE SIGNOS al evaluar límites.",
        "7. Series: declara la prueba exacta y demuéstrala.",
        "8. PREGUNTAS NEGATIVAS ('NO corresponde', 'FALSA', 'INCORRECTA'): evalúa CADA opción con cálculo explícito y encuentra el ÚNICO error.",
        "",
        "ESTRUCTURA DE RESPUESTA:",
        "Tema: ...",
        "Procedimiento: ... (usa LaTeX: $...$ inline, $$...$$ display)",
        "Resultado: ...",
        "Verificación: ...",
        "",
        "ÚLTIMA LÍNEA OBLIGATORIA (exactamente así, sin nada más):",
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
    async function preguntarAI(enunciado, opciones, imagen) {
        const optsStr = opciones.map(o => o.letra + ") " + (o.htmlRaw || o.texto)).join(nl);
        const model = imagen ? MODEL_VISION : MODEL_TEXTO;

        const construirPayload = (m) => {
            const p = {
                model: m,
                messages: [
                    { role: "system", content: SYSTEM_CALCULO },
                    { role: "user", content: "PREGUNTA:\n" + enunciado + nl + nl + "OPCIONES:\n" + optsStr }
                ],
                max_tokens: 3000, temperature: 0.1
            };
            if (imagen) {
                p.max_tokens = 2000;
                p.messages[1].content = [
                    { type: "text", text: "Analiza la imagen.\nENUNCIADO:\n" + enunciado + nl + nl + "OPCIONES:\n" + optsStr },
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
                        console.log("[Solver] Rate limit — esperando " + w + "s...");
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
            console.warn("[Solver] Usando backup...");
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

    console.log("%c⚡ Cálculo II Solver v28 — " + questions.length + " preguntas", "color:cyan;font-weight:bold;font-size:13px;");

    for (let i = 0; i < questions.length; i++) {
        const p = questions[i];
        const panel = crearPanel(p.elemento, quizDoc);

        try {
            const enunciado = htmlToText(p.b?.getAttribute("html") || "");
            const src = await extractImageSrc(p.b);
            const img = src ? await fetchBase64(src) : null;

            console.log("[P" + (i + 1) + "] Enunciado:", enunciado.slice(0, 100));
            console.log("[P" + (i + 1) + "] Opciones (" + p.opts.length + "):", p.opts.map(o => o.letra + ": " + o.texto.slice(0, 50)));

            const res = await preguntarAI(enunciado, p.opts, img);

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
            setStatus("green");
            console.log("%c✅ P" + (i + 1) + " → " + res.letra, "color:lime;font-weight:bold;");

            if (i < questions.length - 1) {
                const delay = 12000 + Math.random() * 8000;
                console.log("[Solver] Esperando " + Math.round(delay / 1000) + "s...");
                await new Promise(r => setTimeout(r, delay));
            }
        } catch (e) {
            panel.innerHTML = "<span style='color:#dc2626;'>❌ Error: " + e.message + "</span>";
            actualizarLegend(p.elemento, "error", "");
            setStatus("red");
            console.error("Error en P" + (i + 1), e);
        }
    }

    console.log("%c✅ Solver v28 completado.", "color:lime;font-weight:bold;font-size:14px;");
})();