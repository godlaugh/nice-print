import os
import sys
import argparse
import base64
import json
from pathlib import Path
from pdf2image import convert_from_path
from openai import OpenAI
from tqdm import tqdm
from dotenv import load_dotenv

load_dotenv()

def encode_image(image_path):
    with open(image_path, "rb") as image_file:
        return base64.b64encode(image_file.read()).decode('utf-8')

def extract_slide_content(client, image_path, page_num):
    base64_image = encode_image(image_path)
    
    prompt = """
    Analyze this slide and extract its content to create a clean, print-friendly version.
    
    IGNORE all decorative background colors, large color blocks, and non-essential graphics.
    FOCUS ONLY on the actual content: text, structure, tables, and meaningful diagrams.
    
    Return the extracted content in JSON format with the following structure:
    {
        "title": "Main title of the slide (if any)",
        "layout_type": "title_only|bullet_points|table|two_column|quote|question|answer_key",
        "content_html": "HTML representation of the content. Use basic HTML tags like <h1>, <h2>, <p>, <ul>, <li>, <table>, <tr>, <td>. DO NOT include <html>, <head>, or <body> tags. Keep styling minimal, we will apply our own print-friendly CSS later."
    }
    
    Ensure all text is captured accurately.
    """
    
    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/jpeg;base64,{base64_image}"
                            }
                        }
                    ]
                }
            ],
            response_format={ "type": "json_object" },
            max_tokens=1500
        )
        
        return json.loads(response.choices[0].message.content)
    except Exception as e:
        print(f"Error extracting content from page {page_num}: {e}")
        return {"title": f"Slide {page_num}", "layout_type": "error", "content_html": f"<p>Error extracting content: {e}</p>"}

def generate_html_slide(content_data, page_num):
    html_template = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <style>
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        body {{
            background: #e0e0e0;
            display: flex;
            justify-content: center;
            padding: 20px;
            font-family: 'Arial', sans-serif;
        }}
        .slide-container {{
            width: 1280px;
            min-height: 720px;
            background: #FFFFFF;
            color: #000000;
            display: flex;
            flex-direction: column;
            position: relative;
            box-shadow: 0 4px 8px rgba(0,0,0,0.1);
            margin-bottom: 20px;
            page-break-after: always;
        }}
        .content-wrapper {{
            flex: 1;
            padding: 60px 80px 0 80px;
            display: flex;
            flex-direction: column;
        }}
        h1, h2, h3 {{
            font-family: 'Arial', sans-serif;
            font-weight: 700;
            color: #000000;
            margin-bottom: 30px;
        }}
        h1 {{ font-size: 64px; text-align: center; margin-top: 100px; }}
        h2 {{ font-size: 48px; padding-bottom: 15px; border-bottom: 3px solid #000000; }}
        p, li, td {{
            font-size: 28px;
            line-height: 1.6;
            color: #333333;
        }}
        ul {{ margin-left: 40px; margin-bottom: 20px; }}
        li {{ margin-bottom: 15px; }}
        table {{
            width: 100%;
            border-collapse: collapse;
            margin-top: 20px;
        }}
        th, td {{
            padding: 15px 20px;
            text-align: left;
            border: 1px solid #000000;
        }}
        th {{ font-weight: bold; background-color: #f0f0f0; }}
        .footer {{
            position: absolute;
            bottom: 30px;
            right: 40px;
            font-size: 16px;
            color: #666666;
        }}
        
        @media print {{
            body {{ background: none; padding: 0; }}
            .slide-container {{ box-shadow: none; margin: 0; }}
        }}
    </style>
</head>
<body>
    <div class="slide-container">
        <div class="content-wrapper">
            {content_data.get('content_html', '')}
        </div>
        <div class="footer">{page_num}</div>
    </div>
</body>
</html>"""
    return html_template

def process_pdf(pdf_path, output_dir):
    if not os.getenv("OPENAI_API_KEY"):
        print("Error: OPENAI_API_KEY environment variable not set.")
        sys.exit(1)
        
    client = OpenAI()
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)
    
    temp_img_dir = output_path / "temp_images"
    temp_img_dir.mkdir(exist_ok=True)
    
    print(f"Converting PDF '{pdf_path}' to images...")
    try:
        images = convert_from_path(pdf_path)
    except Exception as e:
        print(f"Error reading PDF: {e}")
        sys.exit(1)
        
    print(f"Found {len(images)} pages. Starting extraction and conversion...")
    
    all_slides_html = []
    
    for i, image in enumerate(tqdm(images, desc="Processing slides")):
        page_num = i + 1
        img_path = temp_img_dir / f"slide_{page_num}.jpg"
        image.save(img_path, "JPEG")
        
        # Extract content
        content_data = extract_slide_content(client, img_path, page_num)
        
        # Generate HTML for this slide
        slide_html = generate_html_slide(content_data, page_num)
        
        # Save individual slide
        with open(output_path / f"slide_{page_num:03d}.html", "w", encoding="utf-8") as f:
            f.write(slide_html)
            
        all_slides_html.append(slide_html)
        
    # Generate combined HTML file for easy printing
    combined_html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Print Friendly Presentation</title>
    <style>
        body {{ background: #e0e0e0; display: flex; flex-direction: column; align-items: center; padding: 20px; }}
        @media print {{ body {{ background: none; padding: 0; }} }}
    </style>
</head>
<body>
    {''.join([html.split('<body>')[1].split('</body>')[0] for html in all_slides_html])}
</body>
</html>"""

    with open(output_path / "presentation_combined.html", "w", encoding="utf-8") as f:
        f.write(combined_html)
        
    print(f"\nSuccess! Processed {len(images)} slides.")
    print(f"Individual slides and combined presentation saved to: {output_dir}")
    print(f"Open '{output_dir}/presentation_combined.html' in your browser and use Ctrl+P (or Cmd+P) to print/save as PDF.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Convert colorful PDF slides to print-friendly black & white HTML/PDF.")
    parser.add_argument("input_pdf", help="Path to the input PDF file")
    parser.add_argument("output_dir", help="Directory to save the generated files")
    
    args = parser.parse_args()
    
    if not os.path.exists(args.input_pdf):
        print(f"Error: Input file '{args.input_pdf}' not found.")
        sys.exit(1)
        
    process_pdf(args.input_pdf, args.output_dir)