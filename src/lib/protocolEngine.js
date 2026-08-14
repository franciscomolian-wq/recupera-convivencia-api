// Motor de recomendación de protocolos.
// Lee el Manual de Convivencia (RICE) del establecimiento y recomienda un paso a paso.
// GARANTÍA: la ley es el piso mínimo. Los pasos legales nacionales se mantienen SIEMPRE
// (por código); la IA solo puede ENRIQUECER (responsable/base legal) o AGREGAR pasos
// formativos por encima, con plazos acotados al máximo legal. Nunca elimina ni debilita.
const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

export function protocolEngineConfigured() {
  return !!GROQ_API_KEY;
}

export async function recommendProtocol({ typeLabel, nationalSteps, manualText }) {
  const national = (nationalSteps || []).map((s, i) => ({ i, title: s.title, days: s.days ?? 0, role: s.role || "", basis: s.basis || "" }));
  const clean = () => national.map(({ i, ...s }) => ({ ...s, legal: true }));
  const maxDays = Math.max(0, ...national.map((s) => s.days));

  if (!GROQ_API_KEY || !manualText || !String(manualText).trim()) {
    return { steps: clean(), source: "national" };
  }

  const manual = String(manualText).slice(0, 14000);
  const system = "Eres un asistente experto en convivencia escolar chilena y en la normativa vigente (Ley 21.809, Aula Segura 21.128, Ley Karin 21.643, Inclusión 20.845). Estás armando el PROCEDIMIENTO DE ACTUACIÓN ante un hecho (qué hacer cuando el caso YA ocurrió): acogida, resguardo, investigación, entrevistas, notificaciones, medidas y seguimiento del caso. NO es un plan de prevención. NUNCA elimines ni debilites un paso legal; la ley es el piso mínimo obligatorio. Respondes SOLO con JSON válido, sin texto adicional.";
  const user = `Tipo de caso: ${typeLabel}

Pasos legales obligatorios (base nacional — NO se pueden quitar ni acortar sus plazos):
${national.map((s) => `[${s.i}] ${s.title} (plazo: ${s.days} días hábiles, responsable sugerido: ${s.role})`).join("\n")}

Manual de Convivencia del establecimiento (RICE):
"""
${manual}
"""

Tarea: recomienda cómo adaptar el protocolo al manual de ESTE establecimiento, respetando la base legal. Devuelve un JSON con exactamente esta forma:
{
  "enrich": [ { "i": <indice del paso legal>, "role": "<responsable segun el manual, o vacio si no aplica>", "basis": "<base legal existente + referencia al articulo del RICE si el manual lo especifica>" } ],
  "add": [ { "title": "<paso formativo o administrativo propio del manual>", "days": <numero de dias habiles, entre 0 y ${maxDays}>, "role": "<responsable>", "basis": "<referencia al articulo del RICE>", "after": <indice del paso legal tras el cual insertarlo, o -1 para el final> } ]
}
Reglas estrictas:
- SOLO procedimiento de ACTUACIÓN ante el hecho. IGNORA por completo las secciones de PREVENCIÓN, promoción del buen trato, formación general, campañas, charlas, talleres preventivos, plan de gestión de la convivencia, PISE y cualquier medida que no sea una respuesta a un caso puntual. NO las incluyas en "add".
- Del manual, usa únicamente su "protocolo de actuación / procedimiento" para este tipo de caso (responsables, plazos, medidas aplicadas a los involucrados, derivaciones, notificaciones, seguimiento del caso).
- Los pasos de "add" solo pueden ser acciones del procedimiento (ej.: entrevista a apoderados, medida formativa o disciplinaria aplicada al o los estudiantes involucrados, derivación a la red, acompañamiento del caso, seguimiento). NUNCA actividades preventivas generales del establecimiento.
- No inventes obligaciones legales nuevas ni denuncias que la ley no exija.
- Ningún plazo puede superar ${maxDays} días hábiles.
- Si el manual no aporta nada para un paso, deja "role"/"basis" vacíos en "enrich".
Responde SOLO el JSON.`;

  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: { Authorization: "Bearer " + GROQ_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      console.error("Groq error", res.status, t);
      return { steps: clean(), source: "national", error: "ai-failed" };
    }
    const data = await res.json();
    const parsed = JSON.parse(data.choices?.[0]?.message?.content || "{}");

    // Base legal intacta (por código).
    const steps = national.map((s) => ({ title: s.title, days: s.days, role: s.role, basis: s.basis, legal: true }));
    for (const e of parsed.enrich || []) {
      const idx = Number(e.i);
      if (steps[idx]) {
        if (e.role && String(e.role).trim()) steps[idx].role = String(e.role).trim();
        if (e.basis && String(e.basis).trim()) steps[idx].basis = String(e.basis).trim();
      }
    }
    const additions = (parsed.add || []).map((a) => ({
      title: String(a.title || "").trim(),
      days: Math.min(maxDays, Math.max(0, Number(a.days) || 0)),
      role: String(a.role || "").trim(),
      basis: String(a.basis || "").trim(),
      after: Number.isInteger(a.after) ? a.after : -1,
      legal: false,
    })).filter((a) => a.title);

    const result = [];
    steps.forEach((s, i) => {
      result.push(s);
      for (const a of additions.filter((x) => x.after === i)) result.push(a);
    });
    for (const a of additions.filter((x) => x.after < 0 || x.after >= steps.length)) result.push(a);
    return { steps: result, source: "ai" };
  } catch (e) {
    console.error("protocolEngine", e);
    return { steps: clean(), source: "national", error: "exception" };
  }
}
