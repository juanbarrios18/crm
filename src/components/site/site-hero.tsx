import Link from "next/link";
import { getImageProps } from "next/image";
import desktopBanner from "@/assets/banner_desktop.jpg";
import mobileBanner from "@/assets/banner_mobile.png";
import { HERO } from "@/content/lamasfood";

/**
 * Hero de la web pública.
 *
 * Art direction de verdad: son DOS fotos distintas, no la misma recortada. El
 * banner desktop (16:9) y el mobile (768×1376, vertical y denso) son
 * composiciones propias.
 *
 * El contenido va DIRECTO sobre la foto, sin tarjeta. El contraste no lo
 * sostiene un panel blanco sino el scrim: las dos fotos son claras y con mucho
 * detalle (madera, harina, huevos, café), así que el texto claro necesita que
 * el scrim oscurezca de verdad la zona central. Si se reemplaza la foto por
 * otra más clara, hay que subir la opacidad del scrim o el texto pierde
 * lectura.
 *
 * Se resuelve con `<picture>` + `getImageProps` en vez de dos `<Image>` con
 * `priority`: en ese caso Next preloadea AMBAS variantes y el visitante se baja
 * dos imágenes para un solo hero (una queda oculta por CSS).
 */
export function SiteHero() {
  const shared = { alt: "", sizes: "100vw" } as const;

  const desktop = getImageProps({ ...shared, src: desktopBanner });
  const mobile = getImageProps({ ...shared, src: mobileBanner });

  return (
    <section className="relative isolate">
      <picture>
        <source
          media="(min-width: 768px)"
          srcSet={desktop.props.srcSet}
          width={desktop.props.width}
          height={desktop.props.height}
        />
        {/* El srcSet optimizado lo arma `getImageProps`; `<Image>` no soporta
            art direction con `<source media>`. */}
        <img
          {...mobile.props}
          alt=""
          fetchPriority="high"
          className="absolute inset-0 -z-20 h-full w-full object-cover"
        />
      </picture>

      {/* Scrim: es lo ÚNICO que sostiene el texto ahora que no hay tarjeta.
          Es UN solo degradado lineal para los dos breakpoints: medido el piso de
          AA, desktop y mobile piden exactamente lo mismo (el subtítulo manda en
          ambos: alpha 0.62). No hace falta una forma por viewport.
          La meseta cubre del 19% al 79% del alto, que es donde cae el texto; el
          resto del alto se abre porque ahí no hay nada que leer, y es lo que
          deja vivos el café y los huevos de arriba y el pan de abajo.
          Piso medido por elemento (alpha mínimo para AA): eyebrow 0.56,
          H1 0.47 (texto grande), subtítulo 0.62, CTA 0.60. Si cambia el copy,
          hay que volver a medir: la meseta está calzada con el subtítulo. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10"
        style={{
          backgroundImage:
            "linear-gradient(180deg, rgb(var(--site-text-rgb) / 0.20) 0%, rgb(var(--site-text-rgb) / 0.48) 12%, rgb(var(--site-text-rgb) / 0.64) 19%, rgb(var(--site-text-rgb) / 0.64) 79%, rgb(var(--site-text-rgb) / 0.38) 90%, rgb(var(--site-text-rgb) / 0.18) 100%)",
        }}
      />

      <div className="mx-auto flex min-h-[600px] max-w-6xl items-center justify-center px-4 py-20 sm:min-h-[560px] lg:min-h-[660px]">
        <div className="max-w-2xl text-center">
          {/* Texto a opacidad completa: con /80 el eyebrow caía a 3.8:1 sobre la
              madera y no llegaba a AA. El scrim solo no alcanza si el texto
              además se transparenta. */}
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-site-panel [text-shadow:0_1px_10px_rgba(59,42,32,0.6)]">
            {HERO.eyebrow}
          </p>
          <h1 className="mt-4 font-display text-4xl font-semibold leading-[1.1] text-site-panel [text-shadow:0_2px_24px_rgba(59,42,32,0.55)] sm:text-5xl lg:text-6xl">
            {HERO.titleLines[0]}
            <br />
            {HERO.titleLines[1]}
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-site-panel [text-shadow:0_1px_12px_rgba(59,42,32,0.6)]">
            {HERO.subtitle}
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            {/* Sobre el scrim oscuro el CTA principal invierte: el acento marrón
                se perdería contra el fondo, así que manda el panel claro. */}
            <Link
              href={HERO.primaryCta.href}
              className="rounded-full bg-site-panel px-7 py-3 text-sm font-medium text-site-text transition-colors hover:bg-site-bg"
            >
              {HERO.primaryCta.label}
            </Link>
            <a
              href={HERO.secondaryCta.href}
              rel="noopener noreferrer"
              target="_blank"
              className="rounded-full border border-site-panel/70 px-7 py-3 text-sm font-medium text-site-panel transition-colors hover:border-site-panel hover:bg-site-panel/15"
            >
              {HERO.secondaryCta.label}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
