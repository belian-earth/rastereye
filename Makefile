# Makefile for RasterEye VS Code / Positron Extension

.PHONY: all build package clean install rebuild watch help

# Default target - install (if needed), build, and package
all: node_modules build package

# Auto-install deps if node_modules is missing
node_modules: package.json
	@echo "Installing dependencies..."
	@npm install
	@touch node_modules

# Build extension + webview bundles
build: node_modules
	@echo "Building extension and webview..."
	@npm run build
	@echo "✓ Build complete"

# Package extension into .vsix file
package:
	@echo "Packaging extension..."
	@npm run package
	@echo "✓ Package created: rastereye-*.vsix"

# Watch for changes (live rebuild)
watch: node_modules
	@echo "Watching for changes..."
	@npm run watch

# Clean build artifacts
clean:
	@echo "Cleaning build artifacts..."
	@rm -rf dist/
	@rm -f *.vsix
	@echo "✓ Clean complete"

# Force reinstall dependencies
install:
	@echo "Installing dependencies..."
	@npm install
	@touch node_modules

# Rebuild from scratch
rebuild: clean install build package

# Show help
help:
	@echo "RasterEye - Build Commands"
	@echo ""
	@echo "  make              - Install (if needed), build, and package"
	@echo "  make build        - Build extension + webview bundles"
	@echo "  make package      - Create .vsix package"
	@echo "  make watch        - Watch mode (live rebuild on save)"
	@echo "  make clean        - Remove build artifacts"
	@echo "  make install      - Force reinstall npm dependencies"
	@echo "  make rebuild      - Clean rebuild from scratch"
	@echo "  make help         - Show this help message"
