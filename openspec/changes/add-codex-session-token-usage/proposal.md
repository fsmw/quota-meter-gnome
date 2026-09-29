## Why

El dropdown muestra la cuota de la cuenta Codex, pero no el uso de tokens observado en las sesiones locales. Exponer ambos datos por separado permite entender el uso reciente sin confundirlo con la cuota oficial del plan.

## What Changes

- Añadir al detalle Codex el consumo de tokens de la sesión local más reciente y el agregado de las tres sesiones Codex modificadas más recientemente.
- Identificar explícitamente el alcance temporal del agregado y mostrar las dimensiones de tokens disponibles.
- Leer y calcular este uso local de forma asíncrona, acotada y cacheada, con estados comprensibles cuando no existan datos.
- Mantener cuotas reportadas por App Server y uso local en secciones y modelos de datos distintos.

## Capabilities

### New Capabilities
- `codex-observed-usage`: lectura y presentación de uso local de tokens Codex por sesión reciente y agregado acotado.

### Modified Capabilities

## Impact

- Adaptador Codex y normalización/renderizado del menú en `extension/`.
- Archivos JSONL bajo `~/.codex/sessions/`, leídos sin acceder a credenciales.
- Sin cambios a la consulta de cuota de Codex App Server ni a los repositorios de referencia.
