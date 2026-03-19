# Makefile for RasterEye VS Code / Positron Extension

.PHONY: all build package clean install rebuild watch quick help

# Default target - build and package
all: build package

# Build extension + webview bundles
build:
	@echo "Building extension and webview..."
	@npm run build
	@echo "✓ Build complete"

# Package extension into .vsix file
package:
	@echo "Packaging extension..."
	@npm run package
	@echo "✓ Package created: rastereye-*.vsix"

# Watch for changes (live rebuild)
watch:
	@echo "Watching for changes..."
	@npm run watch

# Quick build and package (same as all, for consistency with rsqledit)
quick: build package

# Clean build artifacts
clean:
	@echo "Cleaning build artifacts..."
	@rm -rf dist/
	@rm -f *.vsix
	@echo "✓ Clean complete"

# Install dependencies
install:
	@echo "Installing dependencies..."
	@npm install

# Rebuild from scratch
rebuild: clean install build package

# Show help
help:
	@echo "RasterEye - Build Commands"
	@echo ""
	@echo "  make              - Build and package (default)"
	@echo "  make build        - Build extension + webview bundles"
	@echo "  make package      - Create .vsix package"
	@echo "  make watch        - Watch mode (live rebuild on save)"
	@echo "  make quick        - Build + package (alias for default)"
	@echo "  make clean        - Remove build artifacts"
	@echo "  make install      - Install npm dependencies"
	@echo "  make rebuild      - Clean rebuild from scratch"
	@echo "  make help         - Show this help message"
