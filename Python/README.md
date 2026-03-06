# Nice Print: PDF to Print-Friendly PPT Converter

Turn your colorful, ink-heavy PDF slides into clean, print-friendly, black-and-white presentations. Save ink, save paper, and improve readability.

## Features

- **Ink Saver**: Automatically removes large background color blocks and images, leaving a clean white background.
- **High Contrast**: Converts all text to black for maximum readability on printed paper.
- **Layout Preservation**: Maintains the original slide layout, ensuring no content is lost or displaced.
- **Batch Processing**: Process entire PDF files at once.

## Prerequisites

- Python 3.8+
- `poppler-utils` (for PDF processing)
- OpenAI API Key (for intelligent content extraction and layout analysis)

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/godlaugh/nice-print.git
   cd nice-print
   ```

2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

3. Install system dependencies (Ubuntu/Debian):
   ```bash
   sudo apt-get install poppler-utils
   ```
   (MacOS):
   ```bash
   brew install poppler
   ```

## Usage

1. Set your OpenAI API key:
   ```bash
   export OPENAI_API_KEY='your-api-key-here'
   ```

2. Run the converter:
   ```bash
   python main.py input_slides.pdf output_folder
   ```

   - `input_slides.pdf`: Path to your source PDF file.
   - `output_folder`: Directory where the generated HTML/Image slides will be saved.

## How it Works

1. **PDF to Image**: Converts PDF pages into high-resolution images.
2. **Visual Analysis**: Uses GPT-4o-mini (Vision) to analyze each slide, extracting text, identifying layout structures, and distinguishing content from decorative backgrounds.
3. **Reconstruction**: Generates new HTML slides using the extracted content, applying a clean, print-friendly CSS style.
4. **Export**: (Optional) Can be further converted to PDF using browser print functionality or tools like `wkhtmltopdf`.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License