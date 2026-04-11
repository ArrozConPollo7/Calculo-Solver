(async () => {
    if (window.__solverActivo) { console.warn("[Solver Física] Ya está corriendo, ignorando."); return; }
    window.__solverActivo = true;

    // ========================================================================
    // D2L GROQ SOLVER v26 - FÍSICA 1 (NC1001 EAFIT)
    // Mejoras: stripThinking + rate limit inteligente + KaTeX + RESPUESTA:X
    // ========================================================================

    const GROQ_KEYS = ["DEPLOY_REPLACE_ME"];
    let currentKeyIndex = 0;
    const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

    const MODEL_TEXTO = "qwen/qwen3-32b";
    const MODEL_VISION = "meta-llama/llama-4-scout-17b-16e-instruct";
    const MODEL_BACKUP = "moonshotai/kimi-k2-instruct-0905";

    const nl = String.fromCharCode(10);
    const slash = String.fromCharCode(92);

    window.__groq__ = window.__groq__ || { visible: false };
    window.__groq__.visible = window.__groq__.visible || false;

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
    if (window.__groq_observer__) window.__groq_observer__.disconnect();

    window.__groq_observer__ = new IntersectionObserver((entries) => {
        entries.forEach(e => {
            const div = e.target.__groq_div;
            if (!div) return;
            div.dataset.onScreen = e.isIntersecting ? "true" : "false";
            div.style.display = (window.__groq__.visible && e.isIntersecting) ? "block" : "none";
        });
    }, { threshold: 0.1 });

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

    function renderKaTeX(div) {
        if (!window.renderMathInElement) return;
        try {
            window.renderMathInElement(div, {
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

    // —— Procesamiento de texto ————————————————————————————————————
    // FIX 1: stripThinking — elimina bloques <think> de Qwen antes de procesar
    function stripThinking(raw) {
        return raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    }

    function limpiarRespuestaModelo(raw) {
        const clean = stripThinking(raw);
        const separatorRegex = new RegExp("---+");
        const partes = clean.split(separatorRegex);
        const letraSeccion = partes[partes.length - 1].trim();
        let cuerpo = partes.length >= 2
            ? partes.slice(0, -1).join("---").trim()
            : clean.trim();
        return { justificacion: cuerpo, letraSeccion };
    }

    function prepararHTML(texto) {
        texto = texto
            .split(slash + "(").join("$").split(slash + ")").join("$")
            .split(slash + "[").join("$$").split(slash + "]").join("$$");
        return texto.split(nl).map(l => {
            return l.replace(new RegExp("[*][*]([^*]+)[*][*]", "g"), "<strong>$1</strong>");
        }).join("<br>");
    }

    // —— UI ———————————————————————————————————————————————————————
    function crearDivJustificacion(p) {
        const el = document.createElement("div");
        el.className = "__groq_justification_div";
        el.style.cssText = "display:none;width:100%;max-height:160px;overflow-y:auto;background:transparent;border-top:1px solid rgba(0,0,0,0.07);font-size:11.5px;padding:8px 0;margin-bottom:12px;font-family:system-ui,sans-serif;color:#333;line-height:1.6;";
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
    // FIX 4: Cambiado a "RESPUESTA: X" — más confiable que --- + letra
    const SYSTEM_CALCULO = [
        "Eres un profesor universitario experto en FÍSICA MECÁNICA (NC1001 EAFIT — Serway & Jewett 10ª ed.) con 20 años de experiencia.",
        "Tu única tarea: identificar la respuesta correcta y justificarla con rigor físico y matemático absoluto.",
        "",
        "TEMAS CLAVE (g = 9.8 m/s² siempre):",
        "- Segunda ley: ΣF = ma vectorial por eje.",
        "- Fricción estática: f_s ≤ μ_s·N. Cinética: f_k = μ_k·N.",
        "- Fuerza a ángulo θ MODIFICA la Normal: N = mg ∓ F·sin(θ).",
        "- Atwood: misma T, misma |a|, sentidos opuestos.",
        "- Bloques en contacto: analizar subsistema menor.",
        "- Poleas múltiples sin masa: F = Mg/n_segmentos.",
        "- Péndulo en posición más baja: T > mg SIEMPRE.",
        "- Dinámica circular: ΣF_c = mv²/r hacia el centro.",
        "- Momento lineal: conservación si ΣF_ext = 0.",
        "- W = F·d·cos(θ). W_Normal = 0 siempre.",
        "- Sin fricción: K_i + U_i = K_f + U_f.",
        "- Con fricción: K_i + U_i = K_f + U_f + f_k·d.",
        "- Inelástica perfecta: momento conservado, KE NO.",
        "- KE=½mv². v×2 → KE×4. m×2 → KE×2.",
        "",
        "PROCESO OBLIGATORIO:",
        "1. TIPO: clasifica en una línea.",
        "2. DATOS: extrae todos los valores con unidades.",
        "3. DCL: lista todas las fuerzas sobre cada cuerpo con dirección (+/-).",
        "4. ECUACIONES: ΣFx=ma, ΣFy=0 por cuerpo.",
        "5. DESPEJAR algebraicamente ANTES de sustituir.",
        "6. RESOLVER numéricamente con unidades.",
        "7. VERIFICAR que coincide con una opción.",
        "",
        "REGLAS: Todo en español. JAMÁS digas Ninguna opción coincide.",
        "PREGUNTAS NEGATIVAS: NO, FALSA, INCORRECTA → busca el ÚNICO error.",
        "",
        "OBLIGATORIO: La última línea de tu respuesta debe ser EXACTAMENTE:",
        "RESPUESTA: X",
        "(donde X es A, B, C, D o E — sin más texto en esa línea)"
    ].join(nl);

    // —— Extracción robusta de letra ——————————————————————————————
    function extraerLetra(raw) {
        const clean = stripThinking(raw);
        const lines = clean.split(/[\r\n]+/);

        // 1. Buscar "RESPUESTA: X" — método principal (FIX 4)
        const respTag = clean.match(/RESPUESTA\s*:\s*([A-E])/i);
        if (respTag) return respTag[1].toUpperCase();

        // 2. Separador --- seguido de letra sola
        const sepIdx = lines.map(l => l.trim()).lastIndexOf("---");
        if (sepIdx !== -1) {
            const after = lines.slice(sepIdx + 1).map(l => l.trim()).filter(l => l.length > 0);
            if (after.length > 0 && /^[A-E]$/.test(after[0])) return after[0];
        }

        // 3. Última línea exactamente una letra
        for (let i = lines.length - 1; i >= 0; i--) {
            const l = lines[i].trim();
            if (/^[A-E]$/.test(l)) return l;
        }

        // 4. Frase explícita en últimas 300 chars
        const tail = clean.slice(-300);
        const m = tail.match(/(?:respuesta|opci[oó]n|letra)[^A-Za-z]*([A-E])(?:[^A-Za-z]|$)/i);
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
                p.messages[1].content = [
                    { type: "text", text: "Lee el enunciado y analiza la imagen.\n\nENUNCIADO:\n" + enunciado + nl + nl + "OPCIONES:\n" + optsStr },
                    { type: "image_url", image_url: { url: "data:" + imagen.mimeType + ";base64," + imagen.base64 } }
                ];
                p.max_tokens = 2000;
            }
            return p;
        };

        // FIX 2: Rate limit inteligente — lee segundos exactos de Groq
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
                        console.log("[Solver Física] Rate limit — rotando key, esperando " + w + "s...");
                        await new Promise(res => setTimeout(res, w * 1000));
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
                    await new Promise(res => setTimeout(res, 2000));
                }
            }
            throw new Error("Se agotaron todos los intentos");
        };

        let data;
        try {
            data = await hacerPeticion(model);
        } catch (e) {
            console.warn("[Solver Física] Principal falló (" + e.message + "), usando backup...");
            data = await hacerPeticion(MODEL_BACKUP);
        }

        const raw = data.choices[0].message.content;
        const letra = extraerLetra(raw);
        const res = limpiarRespuestaModelo(raw);
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

    console.log("%c⚡ Física 1 Solver v26 — " + questions.length + " preguntas | Qwen3 + Kimi backup — Física", "color:#00ff88;font-weight:bold;font-size:13px;");

    for (let i = 0; i < questions.length; i++) {
        const p = questions[i];
        const div = crearDivJustificacion(p);
        div.innerHTML = "<em>⏳ Resolviendo pregunta " + (i + 1) + "/" + questions.length + "...</em>";
        if (window.__groq__.visible) div.style.display = "block";

        try {
            const enunciado = htmlToText(p.b?.getAttribute("html") || "");
            const src = await extractImageSrc(p.b);
            const img = src ? await fetchBase64(src) : null;

            console.log("[Física P" + (i + 1) + "] Enunciado:", enunciado.slice(0, 100));
            console.log("[Física P" + (i + 1) + "] Opciones (" + p.opts.length + "):", p.opts.map(o => o.letra + ": " + o.texto.slice(0, 50)));

            const res = await preguntarAI(enunciado, p.opts, img);

            // FIX 3: KaTeX real en vez de codecogs
            div.innerHTML = "<div class='__groq_content'>" + prepararHTML(res.justificacion) + "</div>" +
                "<div style='color:#16a34a;font-weight:bold;margin-top:10px;font-size:14px;'>✓ Respuesta: " + res.letra + "</div>";

            renderKaTeX(div);
            setTimeout(() => renderKaTeX(div), 300);
            setTimeout(() => renderKaTeX(div), 1000);

            marcar(p, res.letra);
            console.log("%c✅ P" + (i + 1) + " → " + res.letra, "color:lime;font-weight:bold;");

            if (i < questions.length - 1) {
                const delay = 12000 + Math.random() * 8000;
                console.log("[Solver Física] Esperando " + Math.round(delay / 1000) + "s...");
                await new Promise(r => setTimeout(r, delay));
            }
        } catch (e) {
            div.innerHTML = "<span style='color:#dc2626'>❌ Error: " + e.message + "</span>";
            console.error("Error en P" + (i + 1), e);
        }
    }

    console.log("%c✅ Solver v26 completado.", "color:lime;font-weight:bold;font-size:14px;");
})();