/**
 * Hook de arranque de Next. El trabajo real vive en instrumentation-node.ts
 * (import dinámico condicionado al runtime para que el bundler edge no
 * intente resolver dependencias de Node como `postgres`).
 */
export async function register(): Promise<void> {
  /*
   * Avisos de configuración de hosting (007). Es puro y barato, así que corre
   * en cualquier runtime. Existe porque una desincronización entre el host del
   * CRM y la URL pública no rompe nada visible: solo hace que el canonical del
   * sitio apunte al admin. Un warning en el arranque es la única señal temprana.
   */
  const { hostingWarnings } = await import("./lib/hosts");
  for (const warning of hostingWarnings()) {
    console.warn(`[boot] configuración de hosts: ${warning}`);
  }

  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { cleanupOrphanRuns } = await import("./instrumentation-node");
    await cleanupOrphanRuns();
  }
}
