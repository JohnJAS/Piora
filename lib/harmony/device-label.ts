export interface HarmonyDeviceLabelSource {
  serial: string;
  /** User-configured device nickname, which is not necessarily the hardware model. */
  name?: string;
  /** Certified hardware model from const.product.model, for example ALN-AL00. */
  model?: string;
  /** Market/product name from const.product.name, for example HUAWEI Mate 60 Pro. */
  product?: string;
}

function cleanPart(value: string | undefined): string | undefined {
  const cleaned = value?.replace(/\s+/g, " ").trim();
  return cleaned && !/^(unknown(?:\.{3})?|null|undefined)$/i.test(cleaned) ? cleaned : undefined;
}

/** Retain display identity only. Connection state and capabilities always come from a fresh probe. */
export function rememberHarmonyDeviceIdentity<T extends HarmonyDeviceLabelSource>(cache: Map<string, HarmonyDeviceLabelSource>, device: T): T {
  const previous = cache.get(device.serial);
  const identity = {
    serial: device.serial,
    model: cleanPart(device.model) ?? previous?.model,
    product: cleanPart(device.product) ?? previous?.product,
    name: cleanPart(device.name) ?? previous?.name,
  };
  cache.delete(device.serial);
  cache.set(device.serial, identity);
  if (cache.size > 100) cache.delete(cache.keys().next().value!);
  return { ...device, ...identity };
}

function sameIdentity(left: string | undefined, right: string | undefined): boolean {
  return Boolean(left && right && left.localeCompare(right, undefined, { sensitivity: "base" }) === 0);
}

/** Keep the physical product/model primary; a user nickname is supplemental. */
export function formatHarmonyDeviceLabel(device: HarmonyDeviceLabelSource): string {
  const product = cleanPart(device.product);
  const model = cleanPart(device.model);
  const nickname = cleanPart(device.name);
  const serial = cleanPart(device.serial) ?? "Harmony device";

  const hardware = product && model && !sameIdentity(product, model)
    ? `${product} (${model})`
    : product ?? model;
  if (!hardware) return nickname ?? serial;
  if (!nickname || sameIdentity(nickname, product) || sameIdentity(nickname, model)) return hardware;
  return `${hardware} · ${nickname}`;
}

/** Small mirror titles show a readable product name; certification codes stay in details. */
export function formatHarmonyDeviceTitle(device: HarmonyDeviceLabelSource, fallback = "鸿蒙设备"): string {
  const code = /^[A-Z0-9]{2,10}[-_][A-Z0-9-]{2,12}$/i;
  return [cleanPart(device.product), cleanPart(device.name)].find(value => value && !code.test(value)) ?? fallback;
}
