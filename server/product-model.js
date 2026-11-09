import { normalizeLlmEndpoint, requestJsonContent } from "./llm.js";
import { StudioError } from "./store.js";

export function chooseProductModel(models, current, explicit = "") {
  const requested = models.find((m) => m.id === (explicit || current));
  if (requested?.capabilities?.vision === false && explicit)
    throw new StudioError(
      "Model Product đã chọn không hỗ trợ đọc ảnh. Chọn model vision.",
      "PRODUCT_MODEL_NO_VISION",
      422,
    );
  if (explicit)
    return {
      id: explicit,
      visionVerified: requested?.capabilities?.vision === true,
    };
  if (requested?.capabilities?.vision === true)
    return { id: current, visionVerified: true };
  const visual = models.filter((m) => m.capabilities?.vision === true);
  // Prefer a fast tier advertised by this exact endpoint; do not invent aliases
  // or change the News/global LLM setting.
  const selected =
    visual.find((m) => /flash-low$/i.test(m.id)) ||
    visual.find((m) => /flash$/i.test(m.id)) ||
    visual[0];
  if (selected) return { id: selected.id, visionVerified: true };
  if (requested?.capabilities?.vision === false)
    throw new StudioError(
      "Model hiện tại không đọc được ảnh và endpoint chưa cung cấp model vision. Chọn model Product hỗ trợ ảnh.",
      "PRODUCT_MODEL_NO_VISION",
      422,
    );
  return { id: current, visionVerified: false };
}

export async function productLlm(
  store,
  request,
  { signal, fetchImpl = globalThis.fetch } = {},
) {
  const settings = store.state.settings.llm || {};
  if (!settings.enabled)
    throw new StudioError(
      "Bật LLM trong Cài đặt trước khi nghiên cứu Product.",
      "LLM_DISABLED",
      409,
    );
  let models = [];
  try {
    const timeout = AbortSignal.timeout(15000),
      response = await fetchImpl(
        `${normalizeLlmEndpoint(settings.endpoint)}/models`,
        {
          headers: settings.apiKey
            ? { authorization: `Bearer ${settings.apiKey}` }
            : {},
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        },
      );
    if (response.ok) {
      const body = await response.json();
      models = (body.data || body.models || []).map((m) =>
        typeof m === "string" ? { id: m } : m,
      );
    }
  } catch (error) {
    if (signal?.aborted) throw error;
  }
  const model = chooseProductModel(
    models,
    settings.model,
    request.researchModel,
  );
  const isolated = {
    state: {
      settings: {
        ...store.state.settings,
        llm: { ...settings, model: model.id },
      },
    },
  };
  return {
    model,
    llm: (system, input, options) =>
      requestJsonContent(isolated, system, input, {
        timeoutSeconds: 180,
        ...options,
      }),
  };
}
