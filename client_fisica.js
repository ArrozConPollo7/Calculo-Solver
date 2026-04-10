
(function () {
    // 4. PUNTO VERDE DE START (Opacidad baja)
    const initDot = document.createElement("div");
    initDot.style = "position:fixed; top:2px; left:6px; width:4px; height:4px; border-radius:50%; background:#00ff88; opacity:0.15; z-index:99999; pointer-events:none;";
    document.body.appendChild(initDot);

    const nl = "\n";
    // TUS LLAVES A MANO (Pero el Worker inyectará las reales desde Cloudflare)
    const GROQ_KEYS = ["DEPLOY_REPLACE_ME"];
    let currentKeyIndex = 0;
    const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
    
    // ESTRATEGIA DE MODELOS
    const MODEL_ESTANDAR = "qwen-3-32b";
    const MODEL_PRO = "gpt-oss-120b";
    const MODEL_VISION = "llama-4-scout-preview";

    // TEMAS PRO PARA FÍSICA
    const KEYWORDS_PRO_FISICA = ["circular", "centrípeta", "fuerza central", "energía", "conservación", "momento", "lineal", "colisión", "choque", "elástico"];

    const SYSTEM_FISICA = "Eres un físico experto en Mecánica (Serway). Define sistema de referencia. Resuelve algebraicamente paso a paso. Selecciona la opción que matemáticamente corresponda al resultado final.";

    function formulaAImagen(latex) {
        const clean = latex.replace(/\\\(/g, "").replace(/\\\)/g, "").replace(/\\\[/g, "").replace(/\\\]/g, "").replace(/\$/g, "").trim();
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
        wrapper.style = "margin:8px 0; padding:10px; background:#121212; border-radius:6px; border-left:3px solid #00ff88; color:#eee; font-family:sans-serif; display:none;";
        wrapper.innerHTML = `
            <div style="display:flex;justify-content:space-between;font-size:10px;">
                <span id="modo-${id}" style="color:#00ff88;font-weight:bold;">FISICA: CARGANDO...</span>
                <span id="letra-${id}" style="background:#00ff88;color:#000;padding:1px 5px;border-radius:3px;font-weight:bold;">...</span>
            </div>
            <div id="proc-${id}" style="max-height:80px;overflow-y:auto;color:#bbb;font-size:11px;margin-top:5px;">Analizando dinámica...</div>
        `;
        container.appendChild(wrapper);

        document.addEventListener("keydown", (e) => {
            if (e.key.toLowerCase() === "x") {
                wrapper.style.display = wrapper.style.display === "none" ? "block" : "none";
            }
        });
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
                document.getElementById(`modo-${id}`).innerText = "MODO: " + modelo.toUpperCase();
                document.getElementById(`proc-${id}`).innerHTML = procedimiento.replace(/\n/g, "<br>").replace(/(\\\(.*?\\\)|\\\[.*?\\\]|\$.*?\$)/g, (m) => formulaAImagen(m));
                document.getElementById(`letra-${id}`).innerText = letra;

                const radios = q.querySelectorAll('input[type="radio"]');
                const targetIdx = letra.charCodeAt(0) - 65;
                if (radios[targetIdx]) radios[targetIdx].click();
            }).catch(e => {
                marcarError(q);
                document.getElementById(`proc-${id}`).innerText = "Error: " + e.message;
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
    
    document.querySelectorAll(".d2l-quiz-question-container, fieldset.dfs_m, .d2l-quiz-question-autosave-container").forEach(q => observer.observe(q));
})();
