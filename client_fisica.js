(async () => {
    if (window.__solverActivo) { console.warn("[Solver Física] Ya está corriendo, ignorando."); return; }
    window.__solverActivo = true;

    // ========================================================================
    // D2L GROQ SOLVER - FÍSICA 1 (NC1001 EAFIT)
    // ========================================================================

    const GROQ_KEYS = ["DEPLOY_REPLACE_ME"];
    let currentKeyIndex = 0;
    const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

    // Kimi K2 para texto (mejor razonamiento multi-paso)
    // Qwen3-32B como fallback
    // Llama 4 Scout para imágenes/diagramas de física
    const MODEL_TEXTO = "moonshotai/kimi-k2-instruct-0905";
    const MODEL_BACKUP = "qwen/qwen3-32b";
    const MODEL_VISION = "meta-llama/llama-4-scout-17b-16e-instruct";

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
            i2?.contentWindow.removeEventListener("keydown", window.__groq_toggle_fn__);
        } catch (e) { }
    }

    // —— KaTeX ————————————————————————————————————————————————————
    async function cargarKaTeX() {
        if (window.katex) return;
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = "https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.css";
        document.head.appendChild(link);
        const loadScript = src => new Promise((res, rej) => {
            const s = document.createElement("script"); s.src = src;
            s.onload = res; s.onerror = rej; document.head.appendChild(s);
        });
        await loadScript("https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.js");
        await loadScript("https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/contrib/auto-render.min.js");
    }

    // —— Procesamiento de texto ————————————————————————————————————
    function filtrarLineasExplicativas(cuerpo) {
        const lineas = cuerpo.split(nl);
        const filtradas = lineas.filter(l => {
            const t = l.trim();
            if (t.length === 0) return true;
            if (t.includes("$")) return true;
            if (t.includes(":") || t.startsWith("#")) return true;
            if (new RegExp("^[0-9]+[\\.\\)]").test(t)) return true;
            if (t.length > 50 && (t.includes(slash) || t.includes("{") || t.includes("}"))) return true;
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
        return texto.split(nl).map(l => {
            if (l.includes("$")) return l;
            return l.replace(new RegExp("[*][*]([^*]+)[*][*]", "g"), "<strong>$1</strong>");
        }).join("<br>");
    }

    function renderizarMath(div) {
        if (!window.renderMathInElement) return;
        try {
            window.renderMathInElement(div, {
                delimiters: [
                    { left: "$$", right: "$$", display: true },
                    { left: "$", right: "$", display: false }
                ],
                throwOnError: false, strict: false
            });
        } catch (e) { }
    }

    // —— UI ———————————————————————————————————————————————————————
    function crearDivJustificacion(p) {
        const el = document.createElement("div");
        el.className = "__groq_justification_div";
        el.style.cssText = "display:none;width:100%;max-height:160px;overflow-y:auto;background:transparent;border-top:1px solid rgba(0,0,0,0.07);font-size:11.5px;padding:8px 0;margin-bottom:12px;font-family:system-ui,sans-serif;color:#333;line-height:1.5;";
        const target = p.elemento;
        if (target.nextSibling) {
            target.parentElement.insertBefore(el, target.nextSibling);
        } else {
            target.parentElement.appendChild(el);
        }
        return el;
    }

    function actualizarVisibilidad() {
        document.querySelectorAll(".__groq_justification_div").forEach(d => {
            d.style.display = window.__groq__.visible ? "block" : "none";
        });
    }

    const toggleX = (e) => {
        if (e.key.toLowerCase() !== 'x') return;
        if (window.__groq_last_t === e.timeStamp) return;
        window.__groq_last_t = e.timeStamp;
        window.__groq__.visible = !window.__groq__.visible;
        actualizarVisibilidad();
    };
    window.__groq_toggle_fn__ = toggleX;
    window.addEventListener("keydown", toggleX);

    // —— DOM Utils ——————————————————————————————————————————————
    function htmlToText(html) {
        if (!html) return "";
        const d = document.createElement("div");
        d.innerHTML = html.replace(new RegExp("&nbsp;", "g"), " ");
        let t = d.textContent || d.innerText || "";
        return t.split(new RegExp("[\\r\\n\\t]+", "g")).join(" ").split(new RegExp(" {2,}", "g")).join(" ").trim();
    }

    async function extractImageSrc(el) {
        for (let t = 0; t < 10; t++) {
            const rend = el?.querySelector("div.d2l-html-block-rendered img");
            if (rend) return rend.getAttribute("src");
            await new Promise(r => setTimeout(r, 200));
        }
        return el?.querySelector("img")?.getAttribute("src");
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

    // —— Extracción robusta de letra ——————————————————————————————
    function extraerLetra(raw) {
        const rawLines = raw.split(new RegExp("[\r\n]+"));

        // 1. Separador --- seguido de letra sola
        const sepIdx = rawLines.map(l => l.trim()).lastIndexOf("---");
        if (sepIdx !== -1 && sepIdx < rawLines.length - 1) {
            const afterSep = rawLines.slice(sepIdx + 1).map(l => l.trim()).filter(l => l.length > 0);
            if (afterSep.length > 0 && new RegExp("^[A-E]$").test(afterSep[0])) {
                return afterSep[0].toUpperCase();
            }
        }

        // 2. Última línea exactamente una letra
        for (let li = rawLines.length - 1; li >= 0; li--) {
            const l = rawLines[li].trim();
            if (new RegExp("^[A-E]$").test(l)) return l;
        }

        // 3. Frases explícitas en últimas 300 chars
        const tail = raw.slice(-300);
        const m = tail.match(new RegExp("(?:respuesta|opci[oó]n|letra)[^A-Za-z]*([A-E])(?:[^A-Za-z]|$)", "i"));
        if (m) return m[1].toUpperCase();

        // 4. letraSeccion aislada
        const res = limpiarRespuestaModelo(raw);
        const m2 = res.letraSeccion.toUpperCase().match(new RegExp("^[\\s]*([A-E])[\\s]*$"));
        if (m2) return m2[1];

        return "A";
    }

    // —— Prompt Física 1 ——————————————————————————————————————————
    const SYSTEM_FISICA = [
        "Eres un profesor universitario experto en FÍSICA MECÁNICA (NC1001 EAFIT — Serway & Jewett 10ª ed.) con 20 años de experiencia resolviendo exámenes de selección múltiple.",
        "Tu única tarea: identificar la respuesta correcta y justificarla con rigor físico y matemático absoluto.",
        "",
        "TEMAS CLAVE:",
        "LEYES DE NEWTON Y FUERZAS (g = 9.8 m/s² siempre):",
        "- Segunda ley: ΣF = ma vectorial por eje.",
        "- Fricción estática: f_s ≤ μ_s·N. Cinética: f_k = μ_k·N.",
        "- Fuerza a ángulo θ MODIFICA la Normal: N = mg ∓ F·sin(θ).",
        "- Atwood: misma T, misma |a|, sentidos opuestos.",
        "- Bloques en contacto: analizar subsistema menor para fuerza de contacto.",
        "- Poleas múltiples sin masa: F = Mg/n_segmentos.",
        "- Péndulo en posición más baja: T − mg = mv²/r → T > mg SIEMPRE.",
        "- Báscula inclinada: mide Normal, NO el peso. masa_aparente = N/g.",
        "- Dinámica circular: ΣF_c = mv²/r hacia el centro.",
        "- Momento lineal: conservación si ΣF_ext = 0.",
        "- Retroceso: m₁v₁ = m₂v₂.",
        "",
        "TRABAJO Y ENERGÍA:",
        "- W = F·d·cos(θ). W_Normal = 0 siempre.",
        "- Teorema trabajo-energía: W_neto = ΔK.",
        "- Sin fricción: K_i + U_i = K_f + U_f.",
        "- Con fricción: K_i + U_i = K_f + U_f + f_k·d.",
        "- Resorte: F=kx, U_e=½kx². Doble extensión → 4× la energía.",
        "",
        "COLISIONES:",
        "- Inelástica perfecta: momento conservado, KE NO.",
        "- Bala-bloque: inelástica → KE se disipa parcialmente.",
        "- Elástica: momento Y KE conservados.",
        "- KE=½mv². v×2 → KE×4. m×2 → KE×2.",
        "",
        "PROCESO OBLIGATORIO:",
        "1. TIPO: clasifica en una línea.",
        "2. DATOS: extrae TODOS los valores con unidades.",
        "3. DCL: lista todas las fuerzas sobre cada cuerpo con dirección (+/-).",
        "4. ECUACIONES: ΣFx=ma, ΣFy=0 por cuerpo. Restricción cinemática si hay polea.",
        "5. DESPEJAR algebraicamente ANTES de sustituir.",
        "6. RESOLVER numéricamente con unidades.",
        "7. VERIFICAR que coincide exactamente con una opción.",
        "",
        "REGLAS:",
        "- Todo en español. g = 9.8 m/s².",
        "- LaTeX inline $...$ y display $$...$$",
        "- JAMÁS digas 'Ninguna opción coincide'. Siempre elige la más cercana.",
        "- CUIDADO: preguntas con 'NO', 'FALSA', 'INCORRECTA' → busca el ÚNICO error.",
        "- Al final escribe exactamente '---' y en la siguiente línea SOLO la letra (A, B, C, D o E)."
    ].join(nl);

    // —— Llamada a la API con rotación de keys ————————————————————
    async function preguntarAI(enunciado, opciones, imagen) {
        const optsStr = opciones.map(o => o.letra + ") " + o.texto).join(nl);
        const model = imagen ? MODEL_VISION : MODEL_TEXTO;

        const construirPayload = (modeloParam) => {
            const p = {
                model: modeloParam,
                messages: [
                    { role: "system", content: SYSTEM_FISICA },
                    { role: "user", content: (imagen ? "Analiza el diagrama o gráfica adjunta. " : "") + "Pregunta: " + enunciado + nl + nl + "Opciones:" + nl + optsStr }
                ],
                max_tokens: imagen ? 4096 : 8000,
                temperature: 0.1
            };
            if (imagen) {
                p.messages[1].content = [
                    { type: "text", text: SYSTEM_FISICA + nl + enunciado + nl + optsStr },
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
                        const wait = 20 + i * 10;
                        console.log("[Solver Física] Rate limit — rotando key, esperando " + wait + "s...");
                        await new Promise(res => setTimeout(res, wait * 1000));
                        continue;
                    }
                    if (!r.ok) throw new Error("API Error " + r.status);
                    const data = await r.json();
                    return data.choices[0].message.content;
                } catch (err) {
                    if (i === GROQ_KEYS.length * 3 - 1) throw err;
                    currentKeyIndex = (currentKeyIndex + 1) % GROQ_KEYS.length;
                    await new Promise(res => setTimeout(res, 2000));
                }
            }
        };

        let raw;
        try {
            raw = await hacerPeticion(model);
        } catch (e) {
            console.warn("[Solver Física] Kimi falló, intentando con Qwen...", e.message);
            raw = await hacerPeticion(MODEL_BACKUP);
        }

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

    const questions = [];

    doc.querySelectorAll("fieldset.dfs_m").forEach(fs => {
        const opts = [];
        fs.querySelectorAll("tr.d2l-rowshadeonhover").forEach((r, i) => {
            const b = r.querySelector("d2l-html-block");
            opts.push({ row: r, letra: "ABCDE"[i], texto: htmlToText(b?.getAttribute("html")) });
        });
        questions.push({ tipo: "parcial", elemento: fs, opts, b: fs.previousElementSibling });
    });

    if (questions.length === 0) {
        doc.querySelectorAll(".d2l-quiz-question-autosave-container").forEach(c => {
            const b = c.querySelector("d2l-html-block");
            const opts = [];
            c.querySelectorAll("tr").forEach((r) => {
                const radio = r.querySelector("input[type=radio]");
                const block = r.querySelector("d2l-html-block");
                if (radio && block) opts.push({ row: r, letra: "ABCDE"[opts.length], texto: htmlToText(block.getAttribute("html")) });
            });
            questions.push({ tipo: "quiz", elemento: c, opts, b });
        });
    }

    console.log("%c⚡ Física 1 Solver — " + questions.length + " preguntas | Kimi K2 + Qwen3-32B", "color:#00ff88;font-weight:bold;font-size:13px;");

    for (let i = 0; i < questions.length; i++) {
        const p = questions[i];
        const div = crearDivJustificacion(p);
        div.innerHTML = "<em>⏳ Resolviendo pregunta " + (i + 1) + "/" + questions.length + "...</em>";
        if (window.__groq__.visible) div.style.display = "block";

        try {
            const enunciado = htmlToText(p.b?.getAttribute("html") || "");
            const src = await extractImageSrc(p.b);
            const img = src ? await fetchBase64(src) : null;

            console.log("[Física P" + (i + 1) + "] Enunciado:", enunciado.slice(0, 80));
            console.log("[Física P" + (i + 1) + "] Opciones:", p.opts.map(o => o.letra + ": " + o.texto.slice(0, 50)));

            const res = await preguntarAI(enunciado, p.opts, img);

            div.innerHTML = "<div>" + prepararHTML(res.justificacion) + "</div>" +
                "<div style='color:#16a34a;font-weight:bold;margin-top:8px;font-size:13px;'>✓ Respuesta: " + res.letra + "</div>";

            renderizarMath(div);
            setTimeout(() => renderizarMath(div), 300);
            setTimeout(() => renderizarMath(div), 1000);

            marcar(p, res.letra);
            console.log("%c✅ Física P" + (i + 1) + " → " + res.letra, "color:lime;font-weight:bold;");

            if (i < questions.length - 1) {
                const delay = 12000 + Math.random() * 8000;
                console.log("[Solver Física] Esperando " + Math.round(delay / 1000) + "s...");
                await new Promise(r => setTimeout(r, delay));
            }
        } catch (e) {
            div.innerHTML = "<span style='color:#dc2626'>❌ Error: " + e.message + "</span>";
            console.error("Error en Física P" + (i + 1), e);
        }
    }

    console.log("%c✅ Solver Física completado.", "color:#00ff88;font-weight:bold;font-size:14px;");
})();