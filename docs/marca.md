# Marca en la app

Fuente: Manual de marca ELOG Group v1.0 (septiembre 2026). Tokens en `src/app/globals.css` (`@theme`).

| Uso | Token | Valor |
|---|---|---|
| Acento (superficies, gráficos, puntos de sellers) | `naranja` | #FF9038 |
| Texto y links naranjas sobre claro | `tostado` | #C13E06 |
| Barra superior, botón primario | `grafito` | #3F3E3E |
| Fondo profundo (login) | `carbon` | #2A2726 |
| Fondo claro por defecto | `papel` | #FAF7F4 |
| Texto secundario | `gris-700` | #606060 |
| Bordes, ejes | `gris-400` | #A3A09E 
| Divisores | `gris-200` | #E3DFDB |
| Semánticos, solo datos: centros de envío / partners / notas / errores | `azul` `verde` `ambar` `rojo` | #2B6E8F #2E7D5B #B57C12 #B23A2C |

- Familias: Montserrat 400/500/600 para texto, interfaz y datos (`tnum` en columnas numéricas); Montserrat Alternates 600/700 para etiquetas y números grandes. Self-hosted desde `@fontsource`.
- Radios (manual p.19), cinco brackets: `rounded-field` 4 (campos/chips), `rounded-button` 8 (botones/tarjetas chicas), `rounded-card` 16 (tarjetas/tablas/contenedores), `rounded-panel` 32 (bloques grandes/paneles; manual 32–64), `rounded-pill` 999 (píldoras/estados). Máximo dos radios por pieza.
- Espaciado (manual p.19): base 8, escala `8 · 16 · 24 · 40 · 64 · 96` (tokens `--space-1..6`); sin valores intermedios. Los márgenes internos de controles (botón/campo) son tokens de componente.
- Tipografía (manual p.16), ocho tamaños, no hay noveno: Display 48, H1 36, H2 28, H3 20 (`t-h3`), Cuerpo 16, Cuerpo chico 14 (`t-meta`), Dato 14 (`t-dato`), Etiqueta 12 (`t-etiqueta`/`t-micro`). No se usa 13.
- Logo: vectores extraídos del manual en `public/brand/` (horizontal sin descriptor en blanco y en Grafito, isotipo, favicon). No se reescribe ni se recolorea fuera de esas dos variantes. Resguardo mínimo ½X.
- Rampa de calor de los hexágonos: Papel → Naranja ELOG → Naranja Tostado, seis pasos con rangos en la leyenda.
- Motivo Ruta: una sola línea naranja en la pantalla de ingreso, esquinas de 96 px, entra y sale por los bordes, no cruza el logo.
- Copy: castellano rioplatense, voseo, verbo primero, números antes que adjetivos. "ELOG" siempre en mayúsculas.

## Fuera del manual (decisiones de ingeniería)

- **Sombras** (`shadow-ctrl/card/pop/modal`) y **breakpoints** (móvil/`md`/`lg`): el manual no los define; son tokens propios de la app, documentados en `globals.css`.
- **Cuerpo base de la interfaz a 14 px** (el manual fija Cuerpo en 16): elección deliberada para una herramienta densa de datos. A confirmar con el aprobador de marca si se prefiere 16.
- **Variante de logo positiva sobre claro (Grafito)**: derivada; el manual la marca como FALTA (activo a generar). Pendiente de aprobación de Olván Graffe.
