import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hostingWarnings, isAdminHost, publicBaseUrl } from "@/lib/hosts";
import { isSafeImageRef } from "@/lib/catalog";
import { groupByMasa, groupCatalog, toSiteProduct } from "@/lib/catalog-public";
import { formatClp, formatClpPrecise } from "@/lib/format";

/**
 * 007 — Sitio público: contrato de la imagen de producto y agrupación del
 * catálogo. Son funciones puras, así que se prueban sin levantar Next ni la BD.
 */

describe("007 — isSafeImageRef (referencia de imagen de un producto)", () => {
  it("acepta rutas internas", () => {
    expect(isSafeImageRef("/site/hero.jpg")).toBe(true);
    expect(isSafeImageRef("/api/public/media/ma_abc123")).toBe(true);
  });

  it("acepta URLs http y https", () => {
    expect(isSafeImageRef("https://cdn.example.com/pan.jpg")).toBe(true);
    expect(isSafeImageRef("http://localhost:3000/x.png")).toBe(true);
  });

  it("rechaza esquemas ejecutables (XSS almacenado en el src público)", () => {
    expect(isSafeImageRef("javascript:alert(1)")).toBe(false);
    expect(isSafeImageRef("JavaScript:alert(1)")).toBe(false);
    expect(isSafeImageRef("data:image/svg+xml;base64,PHN2Zz4=")).toBe(false);
    expect(isSafeImageRef("vbscript:msgbox(1)")).toBe(false);
  });

  it("rechaza rutas relativas al protocolo (otro origen)", () => {
    expect(isSafeImageRef("//evil.example.com/x.jpg")).toBe(false);
  });

  it("rechaza vacío y valores absurdamente largos", () => {
    expect(isSafeImageRef("")).toBe(false);
    expect(isSafeImageRef(`/${"a".repeat(2100)}`)).toBe(false);
  });
});

describe("007 — groupCatalog (agrupación por producto)", () => {
  const variant = (
    producto: string,
    masa: string,
    formato: string,
    imagen: string | null = null
  ) => ({ producto, masa, formato, imagen });

  it("agrupa las variantes por producto conservando el orden de entrada", () => {
    const groups = groupCatalog([
      variant("Pan de hamburguesa", "Brioche", "12 cm"),
      variant("Pan de hamburguesa", "Papa", "10 cm"),
      variant("Pan ciabatta", "Blanco XL", "Estandar"),
    ]);

    expect(groups.map((g) => g.producto)).toEqual([
      "Pan de hamburguesa",
      "Pan ciabatta",
    ]);
    expect(groups[0]?.variants).toHaveLength(2);
    expect(groups[1]?.variants).toHaveLength(1);
  });

  it("toma como foto del grupo la primera variante que tenga una", () => {
    const groups = groupCatalog([
      variant("Pan de molde", "Blanco XL", "20 cm", null),
      variant("Pan de molde", "Blanco XL", "30 cm", "/api/public/media/ma_1"),
      variant("Pan de molde", "Papa", "20 cm", "/api/public/media/ma_2"),
    ]);

    expect(groups[0]?.imagen).toBe("/api/public/media/ma_1");
  });

  it("deja `imagen` en null si ninguna variante tiene foto", () => {
    const groups = groupCatalog([variant("Pan de completo", "Papa", "15 cm")]);
    expect(groups[0]?.imagen).toBeNull();
  });

  it("devuelve lista vacía para catálogo vacío (estado degradado)", () => {
    expect(groupCatalog([])).toEqual([]);
  });
});

describe("007 — groupByMasa (la ficha no repite la masa)", () => {
  const v = (masa: string, formato: string) => ({ masa, formato });

  it("agrupa los formatos bajo su masa, sin repetirla en cada línea", () => {
    const masas = groupByMasa([
      v("Brioche", "12 cm"),
      v("Brioche", "11 cm"),
      v("Papa", "30 cm"),
    ]);

    expect(masas.map((m) => m.masa)).toEqual(["Brioche", "Papa"]);
    expect(masas[0]?.variants.map((x) => x.formato)).toEqual(["12 cm", "11 cm"]);
    expect(masas[1]?.variants.map((x) => x.formato)).toEqual(["30 cm"]);
  });

  it("conserva el orden de entrada (la query ya ordena por producto y masa)", () => {
    const masas = groupByMasa([
      v("Papa", "20 cm"),
      v("Blanco XL", "30 cm"),
      v("Papa", "15 cm"),
    ]);

    // "Papa" aparece primero porque su primera variante llegó primero.
    expect(masas.map((m) => m.masa)).toEqual(["Papa", "Blanco XL"]);
    expect(masas[0]?.variants.map((x) => x.formato)).toEqual(["20 cm", "15 cm"]);
  });

  it("una masa con un solo formato sigue siendo un grupo de uno", () => {
    const masas = groupByMasa([v("Brioche", "12 cm")]);
    expect(masas).toHaveLength(1);
    expect(masas[0]?.variants).toHaveLength(1);
  });

  it("devuelve lista vacía sin variantes", () => {
    expect(groupByMasa([])).toEqual([]);
  });
});

describe("007 — toSiteProduct (la web no recibe precios)", () => {
  /**
   * Este test es el guardián de un requisito explícito del negocio: el catálogo
   * público NO publica precios, los cotiza el agente por WhatsApp.
   *
   * No alcanza con no pintar el precio en la ficha: Next serializa los props de
   * los componentes de servidor en el HTML (payload RSC), así que un precio que
   * llega como prop termina en el código fuente de la página. Si alguien ensancha
   * la proyección del sitio, este test tiene que fallar.
   */
  const publicProduct = {
    producto: "Pan de hamburguesa",
    masa: "Brioche",
    formato: "12 cm",
    unidadesPorBolsa: 6,
    precioUnitarioNeto: 370,
    precioBolsaNeto: 2220,
    precioBolsaConIva: 2641.8,
    imagen: null,
    activo: true,
    notas: "nota interna del negocio",
  };

  it("conserva solo lo que la web renderiza", () => {
    const site = toSiteProduct(publicProduct);

    expect(Object.keys(site).sort()).toEqual([
      "formato",
      "imagen",
      "masa",
      "producto",
      "unidadesPorBolsa",
    ]);
  });

  it("no filtra ningún precio, ni por nombre de campo ni por valor", () => {
    const serialized = JSON.stringify(toSiteProduct(publicProduct));

    expect(serialized).not.toMatch(/precio/i);
    expect(serialized).not.toContain("2641");
    expect(serialized).not.toContain("2220");
    expect(serialized).not.toContain("370");
  });

  it("tampoco filtra las notas internas", () => {
    const site = toSiteProduct(publicProduct);
    expect(site).not.toHaveProperty("notas");
    expect(JSON.stringify(site)).not.toContain("nota interna");
  });
});

describe("007 — formato de precios", () => {
  it("redondea el precio de bolsa al peso (CLP no usa decimales)", () => {
    expect(formatClp(2641.8)).toBe("$2.642");
    expect(formatClp(0)).toBe("$0");
  });

  it("conserva decimales en el unitario cuando los tiene", () => {
    expect(formatClpPrecise(400)).toBe("$400");
    expect(formatClpPrecise(440.5)).toBe("$440,5");
  });
});

describe("007 — publicBaseUrl (canonical y Open Graph del sitio)", () => {
  const KEY = ["APP_BASE_URL", "ADMIN_HOST", "SITE_BASE_URL"] as const;
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => { for (const k of KEY) saved[k] = process.env[k]; });
  afterEach(() => {
    for (const k of KEY) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  const set = (env: Partial<Record<(typeof KEY)[number], string>>) => {
    for (const k of KEY) delete process.env[k];
    Object.assign(process.env, env);
  };

  it("deriva el dominio público quitando el prefijo `admin.`", () => {
    set({ APP_BASE_URL: "https://admin.lamasfood.cl" });
    expect(publicBaseUrl()).toBe("https://lamasfood.cl");
  });

  it("SITE_BASE_URL explícito gana sobre cualquier derivación", () => {
    set({ APP_BASE_URL: "https://admin.lamasfood.cl", SITE_BASE_URL: "https://lamasfood.cl/" });
    expect(publicBaseUrl()).toBe("https://lamasfood.cl");
  });

  it("en el setup de un solo host devuelve ese host", () => {
    set({ APP_BASE_URL: "http://localhost:3000" });
    expect(publicBaseUrl()).toBe("http://localhost:3000");
  });

  /*
   * ESTE ES EL CASO DE PRODUCCIÓN CON DOMINIOS HERMANOS.
   * `admin-lamasfood.duckdns.org` NO es un subdominio de `lamasfood.duckdns.org`:
   * son hermanos bajo `duckdns.org`. La derivación solo entiende el prefijo
   * `admin.`, así que acá NO PUEDE adivinar y devuelve el dominio del admin.
   * Consecuencia: canonical y Open Graph del sitio apuntarían al admin.
   * La salida es declarar SITE_BASE_URL (ver .env.example).
   */
  it("con dominios hermanos NO adivina: hay que declarar SITE_BASE_URL", () => {
    set({ APP_BASE_URL: "https://admin-lamasfood.duckdns.org" });
    expect(publicBaseUrl()).toBe("https://admin-lamasfood.duckdns.org");

    set({
      APP_BASE_URL: "https://admin-lamasfood.duckdns.org",
      SITE_BASE_URL: "https://lamasfood.duckdns.org",
    });
    expect(publicBaseUrl()).toBe("https://lamasfood.duckdns.org");
  });
});

describe("007 — isAdminHost con dominios hermanos (DuckDNS)", () => {
  const KEY = ["APP_BASE_URL", "ADMIN_HOST"] as const;
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => { for (const k of KEY) saved[k] = process.env[k]; });
  afterEach(() => {
    for (const k of KEY) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  function set(env: Partial<Record<(typeof KEY)[number], string>>) {
    for (const k of KEY) delete process.env[k];
    Object.assign(process.env, env);
  }

  it("reconoce el admin por APP_BASE_URL aunque no empiece con `admin.`", () => {
    set({ APP_BASE_URL: "https://admin-lamasfood.duckdns.org" });
    expect(isAdminHost("admin-lamasfood.duckdns.org")).toBe(true);
    expect(isAdminHost("lamasfood.duckdns.org")).toBe(false);
  });

  it("ADMIN_HOST explícito también sirve", () => {
    set({
      APP_BASE_URL: "http://localhost:3000",
      ADMIN_HOST: "admin-lamasfood.duckdns.org",
    });
    expect(isAdminHost("admin-lamasfood.duckdns.org")).toBe(true);
  });

  it("la convención `admin.` sola NO alcanza para `admin-`", () => {
    set({ APP_BASE_URL: "http://localhost:3000" });
    expect(isAdminHost("admin-lamasfood.duckdns.org")).toBe(false);
  });
});

describe("007 — hostingWarnings (aviso de configuración al arrancar)", () => {
  const KEY = ["APP_BASE_URL", "ADMIN_HOST", "SITE_BASE_URL"] as const;
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => { for (const k of KEY) saved[k] = process.env[k]; });
  afterEach(() => {
    for (const k of KEY) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });
  function set(env: Partial<Record<(typeof KEY)[number], string>>) {
    for (const k of KEY) delete process.env[k];
    Object.assign(process.env, env);
  }

  it("en desarrollo (un solo host) no molesta con avisos", () => {
    set({ APP_BASE_URL: "http://localhost:3000" });
    expect(hostingWarnings()).toEqual([]);
  });

  it("con subdominio real la derivación alcanza: sin avisos", () => {
    set({ APP_BASE_URL: "https://admin.lamasfood.cl" });
    expect(hostingWarnings()).toEqual([]);
  });

  it("con dominios HERMANOS avisa que hay que declarar SITE_BASE_URL", () => {
    set({ APP_BASE_URL: "https://admin-lamasfood.duckdns.org" });
    const w = hostingWarnings();
    expect(w).toHaveLength(1);
    expect(w[0]).toContain("SITE_BASE_URL");
  });

  it("avisa si SITE_BASE_URL quedó apuntando al host del CRM", () => {
    set({
      APP_BASE_URL: "https://admin.lamasfood.cl",
      SITE_BASE_URL: "https://admin.lamasfood.cl",
    });
    const w = hostingWarnings();
    expect(w).toHaveLength(1);
    expect(w[0]).toContain("MISMO host");
  });

  it("configuración correcta de dos dominios: sin avisos", () => {
    set({
      APP_BASE_URL: "https://admin-lamasfood.duckdns.org",
      ADMIN_HOST: "admin-lamasfood.duckdns.org",
      SITE_BASE_URL: "https://lamasfood.duckdns.org",
    });
    expect(hostingWarnings()).toEqual([]);
  });
});
