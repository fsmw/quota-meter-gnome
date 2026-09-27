# agnome-top

Proyecto para definir y construir una extensión de GNOME Shell 50+ que muestre en el panel superior el consumo y los límites disponibles de proveedores de IA.

## Repositorios de referencia

- [`agtop/`](agtop/README.md): detección de sesiones, extracción de uso y consulta de cuotas de Codex, Claude y saldo DeepSeek. Este checkout contiene cambios locales preexistentes; trátalo como referencia y no sobrescribas esos cambios.
- [`gnome-system-monitor-indicator/`](gnome-system-monitor-indicator/README.md): estructura de una extensión GNOME Shell, indicador de panel, ciclo de actualización/limpieza, preferencias y schema GSettings.

La síntesis de alcance, arquitectura, contrato de datos, política operativa y decisiones confirmadas está en [`docs/definition.md`](docs/definition.md). El plan de cortes aprobado está en [`docs/task-list.md`](docs/task-list.md).

## Estado

MVP personal/experimental: la v1 consulta Codex App Server por stdio, muestra el porcentaje restante en el panel y detalla ventanas/reinicio en el menú. El proceso de Codex CLI conserva la autenticación; la extensión no lee sus archivos de credenciales. Claude cuota y Gemini siguen fuera del MVP. App Server es experimental y no está soportado para producción.

## Desarrollo local

Requiere GJS/GNOME Shell y Codex CLI instalado. Para validar y empaquetar:

```sh
npm test
npm run check
npm run pack
```

Para instalar el bundle personal:

```sh
gnome-extensions install --force dist/agnome-top@local.shell-extension.zip
gnome-extensions enable agnome-top@local
```

La sesión debe reconocer el bundle instalado. Si `enable` indica que la extensión no existe, vuelve a iniciar sesión y habilítala desde la aplicación Extensions. Para retirarla:

```sh
gnome-extensions uninstall agnome-top@local
```

El paquete generado queda en `dist/`. La integración con App Server es experimental y no debe considerarse soportada para producción.
