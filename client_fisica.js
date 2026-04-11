(function () {
    if (window.__solverActivo) { console.warn("[Solver Física] Ya está corriendo, ignorando."); return; }
    window.__solverActivo = true;

    const initDot = document.createElement("div");
    initDot.style = "position:fixed; top:2px; left:2px; width:4px; height:4px; border-radius:50%; background:#00ff88; opacity:0.15; z-index:99999; pointer-events:none;";
    document.body.appendChild(initDot);

    const nl = "\n";
    const GROQ_KEYS = ["DEPLOY_REPLACE_ME"];
    let currentKeyIndex = 0;
    const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

    const MODEL_ESTANDAR = "qwen/qwen3-32b";
    const MODEL_PRO = "qwen/qwen3-32b";
    const MODEL_VISION = "meta-llama/llama-4-scout-17b-16e-instruct";

    const KEYWORDS_PRO_FISICA = [
        "justificación requerida por escrito", "30%", "30 puntos",
        "no corresponde", "falsa", "incorrecta", "afirmación"
    ];

    const SYSTEM_FISICA = [
        "Eres un profesor universitario experto en FÍSICA MECÁNICA (NC1001 EAFIT — Serway & Jewett 10ª ed.) con 20 años de experiencia resolviendo exámenes de selección múltiple.",
        "Tu única tarea: identificar la respuesta correcta y justificarla con rigor físico y matemático absoluto.",
        "",
        "TEMAS CLAVE — PARCIAL 2:",
        "LEYES DE NEWTON Y FUERZAS:",
        "- Segunda ley: ΣF = ma (vectorial, por eje). g = 9.8 m/s² siempre.",
        "- Fricción estática: f_s ≤ μ_s·N. Fricción cinética: f_k = μ_k·N.",
        "- Fuerza a ángulo θ sobre superficie: MODIFICA la Normal. N = mg ∓ F·sin(θ).",
        "- Sistemas Atwood (polea ideal): misma T en toda la cuerda, misma |a|, sentidos opuestos.",
        "- Bloques en contacto: fuerza de contacto por análisis del subsistema menor.",
        "- Poleas múltiples sin masa/fricción: T igual en toda cuerda continua. F = Mg/n_segmentos.",
        "- Péndulo en posición vertical más baja: T − mg = mv²/r → T > mg siempre.",
        "- Báscula en plano inclinado: mide la Normal, NO el peso. masa_aparente = N/g.",
        "- Dinámica circular: ΣF_c = mv²/r hacia el centro.",
        "- Momento lineal: p = mv. Conservación si ΣF_ext = 0.",
        "- Retroceso/disparo: m₁v₁ = m₂v₂ (sistema inicialmente en reposo).",
        "",
        "TRABAJO Y ENERGÍA:",
        "- W = F·d·cos(θ). Trabajo de la Normal: W_N = 0 siempre.",
        "- Teorema trabajo-energía: W_neto = ΔK.",
        "- Conservación energía mecánica (sin fricción): K_i + U_i = K_f + U_f.",
        "- Con fricción: K_i + U_i = K_f + U_f + |W_fricción|. W_f = f_k·d (disipado).",
        "- Resorte: F = kx. U_e = ½kx². Estirar al doble → energía se CUADRUPLICA.",
        "",
        "COLISIONES:",
        "- Perfectamente inelástica: momento SE conserva. KE NO se conserva.",
        "- Bala-bloque incrustada: colisión inelástica → KE se disipa parcialmente.",
        "- Colisión elástica: momento Y energía cinética se conservan.",
        "- KE = ½mv². Doble velocidad → 4× la energía. Doble masa → 2× la energía.",
        "",
        "PROTOCOLO OBLIGATORIO:",
        "1. TIPO: clasifica en una línea (ej: 'Sistema Atwood + trabajo-energía').",
        "2. DATOS: extrae TODOS los valores con unidades. g = 9.8 m/s².",
        "3. DCL: lista todas las fuerzas sobre CADA cuerpo con dirección (+/-).",
        "4. ECUACIONES: ΣFx = ma y ΣFy = 0 por cuerpo. Restricción cinemática si hay polea.",
        "5. DESPEJAR algebraicamente la incógnita ANTES de sustituir números.",
        "6. RESOLVER: sustitución numérica con unidades, paso a paso.",
        "7. VERIFICAR: resultado coincide exactamente con una opción.",
        "",
        "REGLAS ABSOLUTAS:",
        "- Todo en español. Cero inglés.",
        "- LaTeX inline \\(...\\) y display \\[...\\] para todos los símbolos.",
        "- Nunca adivines — si no cuadra, replantea desde el DCL.",
        "- JAMÁS digas 'Ninguna opción coincide'. Siempre elige la más cercana.",
        "",
        "ESTRUCTURA INQUEBRANTABLE:",
        "Tema: (tipo de problema)",
        "Procedimiento: (DCL + ecuaciones + resolución algebraica y numérica)",
        "Resultado: (valor final con unidades)",
        "Verificación: (por qué coincide con la opción elegida)",
        "---",
        "LETRA",
        "(La última línea OBLIGATORIAMENTE tiene SOLO UNA LETRA: A, B, C, D o E)"
    ].join(nl);

    function leerBloque(el) {
        if (!el) return "";
        const sr = el.shadowRoot;
        if (!sr) return el.innerText.trim().slice(0, 1000);
        const div = sr.querySelector("div");
        if (!div) return sr.textContent.replace(/\s{2,}/g, " ").trim().slice(0, 1000);
        const clone = div.cloneNode(true);
        clone.querySelectorAll("mjx-container").forEach(mjx => {
            const mml = mjx.querySelector("mjx-assistive-mml");
            mjx.replaceWith(document.createTextNode(mml ? " " + mml.textContent + " " : ""));
        });
        clone.querySelectorAll("style").forEach(s => s.remove());
        return clone.textContent.replace(/\s{2,}/g, " ").trim().slice(0, 1000);
    }

    function getQuizDoc() {
        try {
            const ctl2 = document.getElementById("ctl_2");
            if (ctl2) {
                const frmPage = ctl2.contentDocument.getElementById("FRM_page");
                if (frmPage) return frmPage.contentDocument;
                return ctl2.contentDocument;
            }
        } catch (e) { }
        return document;
    }

    function formulaAImagen(latex) {
        const clean = latex.replace(/\\\(/g, "").replace(/\\\)/g, "").replace(/\\\[/g, "").replace(/\\\]/g, "").replace(/\$/g, "").trim();
        return `<img src="https://latex.codecogs.com/svg.latex?{\\color{White}${encodeURIComponent(clean)}}" style="vertical-align: middle; max-height: 22px;" />`;
    }

    async function preguntarAI(enunciado, opciones, imagen) {
        const enunciadoMinus = (enunciado || "").toLowerCase();
        let modeloAElegir = MODEL_ESTANDAR;
        if (KEYWORDS_PRO_FISICA.some(k => enunciadoMinus.includes(k))) modeloAElegir = MODEL_PRO;
        if (imagen) modeloAElegir = MODEL_VISION;

        const optsStr = opciones.map(o => o.letra + ") " + o.texto).join(nl);

        const generarPayload = (modeloParam) => {
            const p = {
                model: modeloParam,
                messages: [
                    { role: "system", content: SYSTEM_FISICA },
                    { role: "user", content: "Resuelve con rigor analítico:\n\n" + enunciado + nl + nl + "OPCIONES:\n" + optsStr }
                ],
                temperature: 0.1
            };
            if (imagen) {
                p.messages[1].content = [
                    { type: "text", text: "Analiza el DCL o diagrama y resuelve:\n\n" + enunciado + nl + nl + "OPCIONES:\n" + optsStr },
                    { type: "image_url", image_url: { url: "data:" + imagen.mimeType + ";base64," + imagen.base64 } }
                ];
            }
            return p;
        };

        const realizarPeticion = async (modeloParam) => {
            for (let i = 0; i < GROQ_KEYS.length * 2; i++) {
                const currentKey = GROQ_KEYS[currentKeyIndex];
                try {
                    const r = await fetch(GROQ_URL, {
                        method: "POST",
                        headers: { "Authorization": "Bearer " + currentKey, "Content-Type": "application/json" },
                        body: JSON.stringify(generarPayload(modeloParam))
                    });
                    if (r.status === 429) {
                        currentKeyIndex = (currentKeyIndex + 1) % GROQ_KEYS.length;
                        await new Promise(res => setTimeout(res, 2000));
                        continue;
                    }
                    if (!r.ok) throw new Error("API Error " + r.status);
                    const data = await r.json();
                    const raw = data.choices[0].message.content;
                    const lineas = raw.split(nl).map(l => l.trim()).filter(l => l.length > 0);
                    const ultimaLinea = lineas[lineas.length - 1];
                    const letraMatch = ultimaLinea.match(/^([A-E])[^A-Z]|^([A-E])$|([A-E])$/);
                    const letra = (letraMatch?.[1] || letraMatch?.[2] || letraMatch?.[3] || "A");
                    return { procedimiento: raw.split("---")[0].trim(), letra, modelo: modeloParam };
                } catch (err) {
                    if (i === GROQ_KEYS.length * 2 - 1) throw err;
                    currentKeyIndex = (currentKeyIndex + 1) % GROQ_KEYS.length;
                    await new Promise(res => setTimeout(res, 1000));
                }
            }
        };

        try {
            return await realizarPeticion(modeloAElegir);
        } catch (error) {
            if (modeloAElegir !== MODEL_ESTANDAR) return await realizarPeticion(MODEL_ESTANDAR);
            throw error;
        }
    }

    function crearUI(container, id) {
        const wrapper = document.createElement("div");
        wrapper.id = "sol-wrapper-" + id;
        wrapper.style = "margin:8px 0; padding:10px; background:#121212; border-radius:6px; border-left:3px solid #00ff88; color:#eee; font-family:sans-serif; display:none;";
        wrapper.innerHTML = `
            <div style="display:flex;justify-content:space-between;font-size:10px;">
                <span id="modo-${id}" style="color:#00ff88;font-weight:bold;">SOLVER FÍSICA: CARGANDO...</span>
                <span id="letra-${id}" style="background:#00ff88;color:#000;padding:1px 5px;border-radius:3px;font-weight:bold;">...</span>
            </div>
            <div id="proc-${id}" style="max-height:80px;overflow-y:auto;color:#bbb;font-size:11px;margin-top:5px;">Generando respuesta...</div>
        `;
        container.appendChild(wrapper);
        document.addEventListener("keydown", (e) => {
            if (e.key.toLowerCase() === "x") {
                wrapper.style.display = wrapper.style.display === "none" ? "block" : "none";
            }
        });
    }

    function marcarError(container) {
        const errorDot = document.createElement("div");
        errorDot.style = "position:absolute; bottom:2px; right:2px; color:#ff0000; font-size:6px; opacity:0.1; line-height:1; pointer-events:none;";
        errorDot.innerText = "...";
        container.style.position = "relative";
        container.appendChild(errorDot);
    }

    async function resolverPregunta(q, id) {
        try {
            const qd = q.ownerDocument;
            const todosLosBlockes = qd.querySelectorAll("d2l-html-block");
            const blocksAntes = Array.from(todosLosBlockes).filter(b =>
                q.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_PRECEDING
            );
            const enunciado = leerBloque(blocksAntes[blocksAntes.length - 1]) || "Sin enunciado";

            const opts = Array.from(q.querySelectorAll("tr.d2l-rowshadeonhover")).map((tr, i) => ({
                letra: String.fromCharCode(65 + i),
                texto: leerBloque(tr.querySelector("d2l-html-block"))
            })).filter(o => o.texto.length > 0);

            let imgData = null;
            const lastBlock = blocksAntes[blocksAntes.length - 1];
            const imgEl = lastBlock?.shadowRoot?.querySelector("img") || q.querySelector("img");
            if (imgEl) {
                const r = await fetch(imgEl.src, { credentials: "include" });
                const b = await r.blob();
                imgData = await new Promise(res => {
                    const rd = new FileReader();
                    rd.onloadend = () => res({ base64: rd.result.split(",")[1], mimeType: b.type });
                    rd.readAsDataURL(b);
                });
            }

            console.log(`[Física P${id}] Enunciado:`, enunciado.slice(0, 100));
            console.log(`[Física P${id}] Opciones (${opts.length}):`, opts.map(o => o.letra + ": " + o.texto.slice(0, 60)));

            crearUI(q, id);

            const { procedimiento, letra, modelo } = await preguntarAI(enunciado, opts, imgData);
            qd.getElementById(`modo-${id}`).innerText = "MODO: " + modelo.toUpperCase();
            qd.getElementById(`proc-${id}`).innerHTML = procedimiento.replace(/\n/g, "<br>").replace(/(\\\(.*?\\\)|\\\[.*?\\\]|\$.*?\$)/g, (m) => formulaAImagen(m));
            qd.getElementById(`letra-${id}`).innerText = letra;

            const radios = q.querySelectorAll('input[type="radio"]');
            const targetIdx = letra.charCodeAt(0) - 65;
            if (radios[targetIdx]) radios[targetIdx].click();
        } catch (e) {
            marcarError(q);
            console.error("[Solver Física] Error:", e.message);
        }
    }

    async function procesarEnSerie(quizDoc) {
        const preguntas = Array.from(quizDoc.querySelectorAll("fieldset.dfs_m"));
        console.log("[Solver Física] Preguntas encontradas:", preguntas.length);
        for (let i = 0; i < preguntas.length; i++) {
            const q = preguntas[i];
            if (q.dataset.solved) continue;
            q.dataset.solved = "true";
            const id = Math.random().toString(36).substr(2, 5);
            console.log(`[Solver Física] Procesando pregunta ${i + 1}/${preguntas.length}...`);
            await resolverPregunta(q, id);
            if (i < preguntas.length - 1) await new Promise(r => setTimeout(r, 4000));
        }
        console.log("[Solver Física] ✓ Listo.");
    }

    procesarEnSerie(getQuizDoc());
})();