
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
    try { getQuizDoc().addEventListener("keydown", toggleSolvers); } catch (e) { }


    // ESTRATEGIA DE MODELOS
    const MODEL_ESTANDAR = "qwen/qwen3-32b";
    const MODEL_PRO = "qwen/qwen3-32b";
    const MODEL_VISION = "meta-llama/llama-4-scout-17b-16e-instruct";

    // TEMAS PRO PARA FÍSICA — solo preguntas conceptuales/trampa
    const KEYWORDS_PRO_FISICA = [
        "justificación requerida por escrito", "30%", "30 puntos",
        "no corresponde", "falsa", "incorrecta"
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
                    // Tomar última línea no vacía del response
                    const lineas = raw.split("\n").map(l => l.trim()).filter(l => l.length > 0);
                    const ultimaLinea = lineas[lineas.length - 1];
                    // La letra es un solo carácter A-E al inicio o al final de la última línea
                    const letraMatch = ultimaLinea.match(/^([A-E])[^A-Z]|^([A-E])$|([A-E])$/);
                    const letra = (letraMatch?.[1] || letraMatch?.[2] || letraMatch?.[3] || "A");

                    // Mantener UI discreta: filtrar solo ecuaciones
                    const procLines = raw.split("---")[0].trim().split(nl);
                    let formulaLines = procLines.filter(l => l.includes("$$") || l.includes("$") || l.includes("="));
                    if (formulaLines.length === 0) formulaLines = procLines;

                    return { procedimiento: formulaLines.join("<br>").replace(/(\$\$[\s\S]*?\$\$|\$[\s\S]*?\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\))/g, (m) => formulaAImagen(m)), letra, modelo: modeloParam };
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
        wrapper.style = "margin:5px 0; padding:8px; background:rgba(0,0,0,0.05); border-radius:4px; color:#cccccc; font-family:monospace; font-size:11px; opacity:0.9; display:" + (window.__solverUIOpen ? "block" : "none") + ";";
        wrapper.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                <span id="modo-${id}" style="opacity:0.4; font-size:8px;">...</span>
                <span id="letra-${id}" style="font-weight:bold; font-size:24px; color:#00ff88; text-shadow: 1px 1px 2px #000;">?</span>
            </div>
            <div id="proc-${id}" style="max-height:120px;overflow-y:auto;line-height:1.4; border-top:1px solid rgba(255,255,255,0.05); padding-top:4px;">...</div>
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
            function leerBloque(el) {
                if (!el) return "";
                const sr = el.shadowRoot;
                if (!sr) return el.innerText.trim().slice(0, 500);
                const div = sr.querySelector("div");
                if (!div) return sr.textContent.replace(/\s{2,}/g, " ").trim().slice(0, 500);
                const clone = div.cloneNode(true);
                clone.querySelectorAll("mjx-container").forEach(mjx => {
                    const mml = mjx.querySelector("mjx-assistive-mml");
                    mjx.replaceWith(document.createTextNode(mml ? " " + mml.textContent + " " : ""));
                });
                clone.querySelectorAll("style").forEach(s => s.remove());
                return clone.textContent.replace(/\s{2,}/g, " ").trim().slice(0, 500);
            }

            function buscarEnunciado(blocks) {
                if (blocks.length === 0) return null;
                const texto = leerBloque(blocks[blocks.length - 1]);
                return texto.length > 10 ? texto : null;
            }

            const todosLosBlockes = q.ownerDocument.querySelectorAll("d2l-html-block");
            const blocksAntes = Array.from(todosLosBlockes).filter(b =>
                q.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_PRECEDING
            );
            const enunciado = buscarEnunciado(blocksAntes) || "Sin enunciado";

            const opts = Array.from(q.querySelectorAll("tr.d2l-rowshadeonhover")).map((tr, i) => ({
                letra: String.fromCharCode(65 + i),
                texto: leerBloque(tr.querySelector("d2l-html-block"))
            })).filter(o => o.texto.length > 0);

            let imgData = null;
            // Bug 2: imagen puede estar en shadowRoot del bloque enunciado
            let imgEl = q.querySelector("img");
            if (!imgEl && blocksAntes.length > 0) {
                const lastBlock = blocksAntes[blocksAntes.length - 1];
                imgEl = lastBlock.shadowRoot?.querySelector("img")
                    || lastBlock.querySelector("img");
            }
            if (imgEl) {
                const r = await fetch(imgEl.src, { credentials: "include" });
                const b = await r.blob();
                imgData = await new Promise(res => {
                    const rd = new FileReader();
                    rd.onloadend = () => res({ base64: rd.result.split(",")[1], mimeType: b.type });
                    rd.readAsDataURL(b);
                });
            }

            console.log(`[P${id}] Enunciado:`, enunciado.slice(0, 80));
            console.log(`[P${id}] Opciones:`, opts.map(o => o.letra + ": " + o.texto.slice(0, 40)));

            crearUI(q, id);

            const { procedimiento, letra, modelo } = await preguntarAI(enunciado, opts, imgData);
            const qd = q.ownerDocument;
            qd.getElementById(`modo-${id}`).innerText = "MODO: " + modelo.toUpperCase();
            qd.getElementById(`proc-${id}`).innerHTML = procedimiento.replace(/\n/g, "<br>").replace(/(\$\$[\s\S]*?\$\$|\$[\s\S]*?\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\))/g, (m) => formulaAImagen(m));
            qd.getElementById(`letra-${id}`).innerText = letra;

            const radios = q.querySelectorAll('input[type="radio"]');
            const targetIdx = letra.charCodeAt(0) - 65;
            if (radios[targetIdx]) radios[targetIdx].click();
        } catch (e) { marcarError(q); console.error("[Solver] Error:", e.message); }
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

    const quizDoc = getQuizDoc();

    async function procesarEnSerie() {
        const preguntas = Array.from(quizDoc.querySelectorAll("fieldset.dfs_m"));
        console.log("[Solver] Preguntas encontradas:", preguntas.length);
        for (let i = 0; i < preguntas.length; i++) {
            const q = preguntas[i];
            if (q.dataset.solved) continue;
            q.dataset.solved = "true";
            const id = Math.random().toString(36).substr(2, 5);
            console.log(`[Solver] Procesando pregunta ${i + 1}/${preguntas.length}...`);
            await resolverPregunta(q, id);
            if (i < preguntas.length - 1) {
                await new Promise(r => setTimeout(r, 5000));
            }
        }
        console.log("[Solver] ✓ Listo.");
    }

    procesarEnSerie();
})();
