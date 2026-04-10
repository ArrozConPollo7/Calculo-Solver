
(function () {
    if (window.__solverActivo) { console.warn("[Solver] Ya está corriendo, ignorando."); return; }
    window.__solverActivo = true;
    // 4. PUNTO VERDE MUY PEQUEÑO PARA CONFIRMAR INICIO (Opacidad 15%)
    const initDot = document.createElement("div");
    initDot.style = "position:fixed; top:2px; left:2px; width:4px; height:4px; border-radius:50%; background:#00ff00; opacity:0.15; z-index:99999; pointer-events:none;";
    document.body.appendChild(initDot);

    const nl = "\n";
    // TUS LLAVES A MANO (Pero el Worker inyectará las reales desde Cloudflare)
    const GROQ_KEYS = ["DEPLOY_REPLACE_ME"];
    let currentKeyIndex = 0;
    const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

    window.__solverUIOpen = false;
    const toggleSolvers = (e) => {
        if (e.key.toLowerCase() === "x") {
            window.__solverUIOpen = !window.__solverUIOpen;
            const state = window.__solverUIOpen ? "block" : "none";
            const qd = getQuizDoc();
            if (qd) qd.querySelectorAll("[id^='sol-wrapper-']").forEach(w => w.style.display = state);
            document.querySelectorAll("[id^='sol-wrapper-']").forEach(w => w.style.display = state);
        }
    };
    document.addEventListener("keydown", toggleSolvers);
    try { getQuizDoc().addEventListener("keydown", toggleSolvers); } catch(e){}


    // ESTRATEGIA DE MODELOS REAALES GROQ
    const MODEL_ESTANDAR = "gemma2-9b-it";
    const MODEL_PRO = "llama-3.3-70b-versatile";
    const MODEL_VISION = "llama-3.2-11b-vision-preview";

    // TEMAS PRO PARA FÍSICA Y DETONADORES DEL 30%
    const KEYWORDS_PRO_FISICA = [
        "justificación requerida por escrito", "(30%)", "30 puntos",
        "coeficiente de fricción cinético", "fuerza de contacto",
        "trabajo y energía", "superficie horizontal", "cuerda inextensible",
        "polea ideal", "equilibrio", "tensión en la cuerda",
        "coeficiente de fricción estático", "parte del reposo",
        "fuerza de fricción promedio", "masa en suspensión", "fuerza mínima"
    ];

    const SYSTEM_FISICA = `Eres un profesor universitario experto en FÍSICA MECÁNICA (NC1001 EAFIT — Serway & Jewett 10ª ed.) con 20 años de experiencia.
Tu única tarea: resolver la pregunta y justificarla con rigor físico y matemático absoluto.

TRAMPAS FRECUENTES EN ESTE EXAMEN:
- Si dan una "fuerza de fricción promedio", recuerda disipar energía por fricción (W_fk = fk * d).
- Fuerza en ángulo sobre superficie: OJO, modifica la Normal. N = M*g - F*sin(theta) o M*g + F*sin(theta).
- Poleas ideales: misma T, misma aceleración, pero direcciones opuestas para cuerpos conectados.
- Trabajo de la normal sobre el plano: siempre es 0 (perpendicular).
- Colisión inelástica: momento se conserva, energía cinética NO se conserva.

PROTOCOLO OBLIGATORIO DE RESPUESTA:
1. DATOS: Extrae todos los datos explícitos e implícitos. g = 9.8 m/s^2.
2. DCL: Escribe un breve Diagrama de Cuerpo Libre textual por masa.
3. ECUACIONES: Escribe las fórmulas de Newton ΣF=ma o Trabajo/Energía E_i + W = E_f. Despeja TODO algebraicamente primero.
4. RESOLUCIÓN: Sustituye valores numéricos y da el resultado final.
5. OPCIONES: Verifica cuál opción es estrictamente igual.

FORMATO OBLIGATORIO:
- Todo en español. Cero inglés.
- Al terminar tu explicación y resolución, escribe OBLIGATORIAMENTE un separador de tres guiones ('---') en una línea nueva.
- En la línea inferior al separador escribe ÚNICAMENTE la letra de la opción correcta (ej: A, B, C, D o E) sin paréntesis ni puntos.`;

    function formulaAImagen(latex) {
        const clean = latex.replace(/\$\$/g, "").replace(/\$/g, "").replace(/\\\[/g, "").replace(/\\\]/g, "").replace(/\\\(/g, "").replace(/\\\)/g, "").trim();
        return `<img src="https://latex.codecogs.com/svg.latex?{\\color{White}${encodeURIComponent(clean)}}" style="vertical-align: middle; max-height: 22px;" />`;
    }

    async function preguntarAI(enunciado, opciones, imagen) {
        const enunciadoMinus = (enunciado || "").toLowerCase();
        let modeloAElegir = MODEL_ESTANDAR;

        // 1. Detección PRO
        if (KEYWORDS_PRO_FISICA.some(k => enunciadoMinus.includes(k))) {
            modeloAElegir = MODEL_PRO;
        }
        if (imagen) modeloAElegir = MODEL_VISION;

        const optsStr = opciones.map(o => o.letra + ") " + o.texto).join(nl);

        const generarPayload = (modeloParam) => {
            const p = {
                model: modeloParam,
                messages: [
                    { role: "system", content: SYSTEM_FISICA },
                    { role: "user", content: "Resuelve con rigor analítico:\n" + enunciado + nl + nl + "OPCIONES:\n" + optsStr }
                ],
                temperature: 0.1
            };
            if (imagen) {
                p.messages[1].content = [
                    { type: "text", text: "Analiza el DCL o diagrama vectorial y resuelve:\n" + enunciado },
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
                        method: "POST", headers: { "Authorization": "Bearer " + currentKey, "Content-Type": "application/json" },
                        body: JSON.stringify(generarPayload(modeloParam))
                    });
                    if (r.status === 429) {
                        currentKeyIndex = (currentKeyIndex + 1) % GROQ_KEYS.length;
                        await new Promise(res => setTimeout(res, 1500));
                        continue;
                    }
                    if (!r.ok) throw new Error("API Error " + r.status);
                    const data = await r.json();
                    const raw = data.choices[0].message.content;
                    const letra = raw.split(nl).pop().replace(/[^A-E]/g, "").trim() || "A";
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
            // 2. FALLBACK A QWEN SI EL PRO/VISUAL FALLA CRÍTICAMENTE
            if (modeloAElegir !== MODEL_ESTANDAR) {
                console.warn("Fallback a Qwen en Física desde:", modeloAElegir);
                return await realizarPeticion(MODEL_ESTANDAR);
            }
            throw error;
        }
    }

    function crearUI(container, id) {
        const wrapper = document.createElement("div");
        wrapper.id = "sol-wrapper-" + id;
        wrapper.style = "margin:8px 0; padding:10px; background:#121212; border-radius:6px; border-left:3px solid #00ff88; color:#eee; font-family:sans-serif; display:" + (window.__solverUIOpen ? "block" : "none") + ";";
        wrapper.innerHTML = `
            <div style="display:flex;justify-content:space-between;font-size:10px;">
                <span id="modo-${id}" style="color:#00ff88;font-weight:bold;">FISICA: CARGANDO...</span>
                <span id="letra-${id}" style="background:#00ff88;color:#000;padding:1px 5px;border-radius:3px;font-weight:bold;">...</span>
            </div>
            <div id="proc-${id}" style="max-height:80px;overflow-y:auto;color:#bbb;font-size:11px;margin-top:5px;">Analizando dinámica...</div>
        `;
        container.appendChild(wrapper);
    }

    // 3. TRES PUNTOS DE FALLO CASI INVISIBLES
    function marcarError(container) {
        const errorDot = document.createElement("div");
        errorDot.style = "position:absolute; bottom:2px; right:2px; color:#ff0000; font-size:6px; opacity:0.1; line-height:1; pointer-events:none;";
        errorDot.innerText = "...";
        container.style.position = "relative";
        container.appendChild(errorDot);
    }

    async function resolverPregunta(q, id) {
        try {
            const body = q.querySelector(".d2l-quiz-question-content") || q;
            const imgEl = body.querySelector("img");
            let imgData = null;
            if (imgEl) {
                const r = await fetch(imgEl.src, { credentials: "include" });
                const b = await r.blob();
                imgData = await new Promise(res => {
                    const rd = new FileReader();
                    rd.onloadend = () => res({ base64: rd.result.split(",")[1], mimeType: b.type });
                    rd.readAsDataURL(b);
                });
            }

            const enunciado = (body.innerText || "").split("\n")[0];
            const opts = Array.from(q.querySelectorAll("tr.d2l-rowshadeonhover, .d2l-quiz-answer-option")).map((opt, i) => ({
                letra: String.fromCharCode(65 + i),
                texto: opt.innerText.trim()
            })).filter(o => o.texto.length > 0);

            crearUI(q, id);

            preguntarAI(enunciado, opts, imgData).then(({ procedimiento, letra, modelo }) => {
                const qd = q.ownerDocument;
                qd.getElementById(`modo-${id}`).innerText = "MODO: " + modelo.toUpperCase();
                qd.getElementById(`proc-${id}`).innerHTML = procedimiento.replace(/\n/g, "<br>").replace(/(\$\$[\s\S]*?\$\$|\$[\s\S]*?\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\))/g, (m) => formulaAImagen(m));
                qd.getElementById(`letra-${id}`).innerText = letra;

                const radios = q.querySelectorAll('input[type="radio"]');
                const targetIdx = letra.charCodeAt(0) - 65;
                if (radios[targetIdx]) radios[targetIdx].click();
            }).catch(e => {
                marcarError(q);
                const errEl = q.ownerDocument.getElementById(`proc-${id}`);
                if (errEl) errEl.innerText = "Error: " + e.message;
            });
        } catch (e) { marcarError(q); }
    }

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting && !entry.target.dataset.solved) {
                entry.target.dataset.solved = "true";
                resolverPregunta(entry.target, Math.random().toString(36).substr(2, 5));
            }
        });
    });

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

    const quizDoc = getQuizDoc();
    const preguntas = quizDoc.querySelectorAll("fieldset.dfs_m");
    console.log("[Solver] Preguntas encontradas:", preguntas.length);
    preguntas.forEach(q => observer.observe(q));
})();
