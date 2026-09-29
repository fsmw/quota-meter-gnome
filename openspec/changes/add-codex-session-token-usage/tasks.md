## 1. Lector de uso local

- [x] 1.1 Implementar enumeración asíncrona de sesiones JSONL Codex y seleccionar las tres rutas más recientes por mtime.
- [x] 1.2 Parsear eventos `token_count` por archivo, conservar dimensiones conocidas y tolerar líneas incompletas o inválidas.
- [x] 1.3 Añadir caché incremental por ruta con offset, buffer parcial y reconstrucción ante truncado/cambio, además de cancelación y descarte al deshabilitar.
- [x] 1.4 Normalizar el resultado como uso observado con sesión más reciente, agregado de N sesiones y estados disponible/parcial/no disponible.

## 2. Integración del dropdown

- [x] 2.1 Integrar el lector al ciclo asíncrono de actualización sin acoplar su fallo al resultado de cuota.
- [x] 2.2 Renderizar sección separada de cuota con uso de sesión más reciente, agregado “últimas N sesiones” y dimensiones disponibles.
- [x] 2.3 Añadir traducciones y estados vacíos/parciales sin exponer rutas, contenido de JSONL o datos sensibles en logs.

## 3. Validación

- [x] 3.1 Añadir verificaciones del parser y agregación para datos completos/parciales, cero a tres sesiones, JSONL truncado, archivo inválido y actualización incremental.
- [x] 3.2 Validar en GNOME 51 la carga y el ciclo habilitar/deshabilitar; revisar cancelación y aislamiento de errores entre cuota y lector local.
