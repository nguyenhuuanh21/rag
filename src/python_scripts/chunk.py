import sys
import re
import json
import fitz
import numpy as np
# Thêm 2 dòng này để ép Windows console dùng UTF-8
if sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')
from PIL import Image
import easyocr


MAX_CHARS = 2500
OVERLAP_BLOCKS = 1

USE_OCR_FALLBACK = True
OCR_MIN_TEXT_LENGTH = 50
OCR_GPU = False

# Khởi tạo OCR
reader = easyocr.Reader(
    ["vi", "en"],
    gpu=OCR_GPU
)

def is_noise_line(line):
    """
    Kiểm tra xem một dòng văn bản có phải là dòng "rác" hay không.
    Dòng rác thường là header, footer, số trang, hoặc các ký tự lặp lại vô nghĩa (như dấu chấm nối trong mục lục).
    """
    line = line.strip()

    noise_patterns = [
        r"^STSV\s*\*\s*\d+$",
        r"^\d+\s*\*\s*STSV$",
        r"^STSV$",
        r"^\d+$",
        r"^[.\s]+$",                       # Lọc các dòng chỉ toàn dấu chấm "........"
        # r"^.+?\.{4,}\s*\d+$"       
    ]

    return any(
        re.match(pattern, line, re.IGNORECASE)
        for pattern in noise_patterns
    )

def clean_text(text):
    """
    Làm sạch một khối văn bản: Chuẩn hóa ký tự xuống dòng (\r\n thành \n), 
    gộp các khoảng trắng thừa thành 1 dấu cách, và loại bỏ hoàn toàn các dòng rác.
    """
    text = re.sub(r"\r\n", "\n", text)
    text = re.sub(r"[ \t]+", " ", text)

    lines = []

    for line in text.splitlines():
        line = line.strip()

        if not line:
            continue

        if is_noise_line(line):
            continue

        lines.append(line)

    return "\n".join(lines).strip()

def normalize_line(line):
    """
    Chuẩn hóa một dòng văn bản đơn lẻ: Xóa khoảng trắng ở 2 đầu 
    và loại bỏ các ký tự đánh dấu tiêu đề của Markdown (như #, ##) nếu có.
    """
    line = line.strip()
    line = re.sub(r"^#{1,6}\s+", "", line).strip()
    return line

def is_roman_heading(line):
    """
    Kiểm tra xem dòng hiện tại có phải là một tiêu đề được đánh số La Mã hay không.
    (Ví dụ: "I. Mở đầu", "IV. Kết luận").
    """
    line = normalize_line(line)

    return re.match(
        r"^(I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|XIII|XIV|XV|XVI|XVII|XVIII|XIX|XX)\.\s+.+$",
        line,
        re.IGNORECASE
    )

def is_table_heading(line):
    """
    Kiểm tra xem dòng hiện tại có khớp chính xác với định dạng thẻ tiêu đề bảng nội bộ hay không.
    (Ví dụ: "[PAGE 1 - TABLE 2]").
    """
    line = normalize_line(line)

    return re.match(
        r"^\[PAGE\s+\d+\s+-\s+TABLE\s+\d+\]$",
        line,
        re.IGNORECASE
    )

def is_table_node_title(title):
    """
    Kiểm tra mở rộng xem một chuỗi có phải là tiêu đề của bảng hay không.
    Bao gồm cả thẻ nội bộ "[PAGE...]" và các tiêu đề bắt đầu bằng chữ "BẢNG" (VD: "BẢNG 1.2").
    """
    title = normalize_line(title)

    return bool(
        re.match(r"^\[PAGE\s+\d+\s+-\s+TABLE\s+\d+\]$", title, re.IGNORECASE)
        or re.match(r"^BẢNG\s+\d+(?:\.\d+)*", title, re.IGNORECASE)
    )

def rect_overlap_area(a, b):
    """
    Tính diện tích phần giao nhau (overlap) giữa 2 hình chữ nhật (bounding boxes).
    Nếu 2 hình không chạm nhau, trả về 0.
    """
    ax0, ay0, ax1, ay1 = a
    bx0, by0, bx1, by1 = b

    x0 = max(ax0, bx0)
    y0 = max(ay0, by0)
    x1 = min(ax1, bx1)
    y1 = min(ay1, by1)

    if x1 <= x0 or y1 <= y0:
        return 0

    return (x1 - x0) * (y1 - y0)

def rect_area(rect):
    """
    Tính tổng diện tích của một hình chữ nhật dựa trên tọa độ (x0, y0, x1, y1).
    """
    x0, y0, x1, y1 = rect
    return max(0, x1 - x0) * max(0, y1 - y0)

def is_block_inside_table(block_bbox, table_bbox, overlap_threshold=0.35):
    """
    Xác định xem một khối văn bản có nằm bên trong khu vực của một bảng biểu hay không.
    Điều kiện: Diện tích phần giao nhau chiếm từ 35% (overlap_threshold) tổng diện tích khối văn bản trở lên.
    """
    block_area = rect_area(block_bbox)

    if block_area <= 0:
        return False

    overlap = rect_overlap_area(block_bbox, table_bbox)

    return (overlap / block_area) >= overlap_threshold

def is_text_row_inside_detected_table(row, min_rows_before_stop=2, current_row_count=0):
    """
    Phát hiện các hàng (row) bị thư viện nhận diện nhầm thành bảng.
    Hàm sử dụng biểu thức chính quy để kiểm tra xem nội dung của hàng này có giống với 
    một câu văn/đoạn văn bản bình thường hay không (dựa trên độ dài, dấu câu, từ khóa tiêu đề).
    """
    cleaned_cells = []

    for cell in row:
        cell = "" if cell is None else str(cell)
        cell = clean_text(cell).replace("\n", " ").strip()
        cleaned_cells.append(cell)

    non_empty = [cell for cell in cleaned_cells if cell]

    if current_row_count < min_rows_before_stop:
        return False

    if not non_empty:
        return False

    row_text = " ".join(non_empty).strip()

    if len(non_empty) > 1:
        return False

    if re.match(r"^\d+(?:\.\d+)*\.\s+[A-ZÀ-Ỹ]", row_text):
        return True

    if re.match(r"^(PHẦN|CHƯƠNG|MỤC|ĐIỀU)\s+", row_text, re.IGNORECASE):
        return True

    if len(row_text) >= 65 and row_text.endswith((".", ";", ":")):
        return True

    if len(row_text.split()) >= 12 and not " | " in row_text:
        return True

    return False

def normalize_overflow_row_as_text(row):
    """
    Chuyển đổi một hàng của bảng (đã được xác định là nhận diện nhầm) 
    trở lại thành một dòng văn bản bình thường bằng cách ghép các ô (cell) lại với nhau.
    """
    cells = []

    for cell in row:
        cell = "" if cell is None else str(cell)
        cell = clean_text(cell).replace("\n", " ").strip()
        if cell:
            cells.append(cell)

    return " ".join(cells).strip()

def format_table_as_text(table_data):
    """
    Biến đổi dữ liệu bảng (mảng 2 chiều) thành định dạng chuỗi văn bản.
    - Các ô được ngăn cách bằng ký tự "|".
    - Bảng được bọc trong tag [TABLE] và [/TABLE].
    - Nếu phát hiện các hàng text bị nhận diện nhầm, hàm sẽ tách chúng ra và trả về dưới dạng văn bản thừa (overflow_text).
    """     
    rows = []
    overflow_lines = []
    overflow_started = False

    for row in table_data:
        if not overflow_started and is_text_row_inside_detected_table(row, current_row_count=len(rows)):
            overflow_started = True

        if overflow_started:
            overflow_text = normalize_overflow_row_as_text(row)
            if overflow_text:
                overflow_lines.append(overflow_text)
            continue

        cells = []

        for cell in row:
            cell = "" if cell is None else str(cell)
            cell = clean_text(cell).replace("\n", " ").strip()
            cells.append(cell)

        if any(cells):
            rows.append(" | ".join(cells))

    table_text = ""
    if rows:
        table_text = "[TABLE]\n" + "\n".join(rows) + "\n[/TABLE]"

    overflow_text = clean_text("\n".join(overflow_lines))

    return table_text, overflow_text

def extract_tables_from_page(page, page_number):
    """
    Quét và trích xuất tất cả các bảng biểu có trên một trang PDF cụ thể.
    Trả về danh sách các object chứa định dạng văn bản của bảng và tọa độ khu vực bảng đó.
    """
    table_items = []

    if not hasattr(page, "find_tables"):
        return table_items

    try:
        tables = page.find_tables()

        for table_index, table in enumerate(tables, start=1):
            table_data = table.extract()
            table_text, overflow_text = format_table_as_text(table_data)

            if not table_text and not overflow_text:
                continue

            bbox = tuple(table.bbox)

            if table_text:
                table_items.append({
                    "type": "table",
                    "bbox": bbox,
                    "y0": bbox[1],
                    "x0": bbox[0],
                    "text": f"[PAGE {page_number} - TABLE {table_index}]\n{table_text}",
                })

            if overflow_text:
                table_items.append({
                    "type": "text",
                    "bbox": bbox,
                    "y0": bbox[3] + 0.01,
                    "x0": bbox[0],
                    "text": overflow_text,
                })

    except Exception as e:
        sys.stderr.write(f"Cannot extract table on page {page_number}: {e}\n")

    return table_items

def extract_non_table_text_blocks(page, table_items):
    """
    Lấy toàn bộ các khối văn bản trên trang, sau đó lọc BỎ những khối 
    nằm đè lên (hoặc nằm trong) khu vực của các bảng biểu đã được tìm thấy trước đó.
    """
    items = []
    table_bboxes = [item["bbox"] for item in table_items]

    try:
        blocks = page.get_text("blocks")
    except Exception:
        blocks = []

    for block in blocks:
        if len(block) < 5:
            continue

        x0, y0, x1, y1, text = block[:5]
        text = clean_text(text)

        if not text:
            continue

        block_bbox = (x0, y0, x1, y1)

        if any(is_block_inside_table(block_bbox, table_bbox) for table_bbox in table_bboxes):
            continue

        items.append({
            "type": "text",
            "bbox": block_bbox,
            "y0": y0,
            "x0": x0,
            "text": text,
        })

    return items

def ocr_page(page):
    """
    Giải pháp dự phòng (Fallback): Dùng thư viện ảnh chụp lại trang PDF và đưa qua
    mô hình AI (EasyOCR) để đọc chữ. Dùng cho các file PDF dạng scan (chỉ chứa hình ảnh).
    """
    pix = page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5))
    img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
    result = reader.readtext(np.array(img), detail=0, paragraph=True)
    return clean_text("\n".join(result))

def extract_pdf_text(pdf_path):
    """
    Hàm điều phối quá trình đọc PDF:
    - Mở file, lặp qua từng trang.
    - Lấy bảng, lấy văn bản, gộp chung và sắp xếp chuẩn xác theo tọa độ từ trên xuống, trái qua phải.
    - Tự động kích hoạt OCR nếu trang có quá ít chữ (< 50 ký tự).
    Trả về toàn bộ văn bản gốc của file PDF.
    """
    doc = fitz.open(pdf_path)
    all_text = []

    # Xóa tqdm để không ghi rác ra stdout làm hỏng JSON của Node.js
    for i, page in enumerate(doc, start=1):
        table_items = extract_tables_from_page(page, i)
        text_items = extract_non_table_text_blocks(page, table_items)

        page_items = text_items + table_items
        page_items.sort(key=lambda item: (round(item["y0"], 1), round(item["x0"], 1)))

        page_text = "\n\n".join(item["text"] for item in page_items if item["text"]).strip()

        if USE_OCR_FALLBACK and len(page_text.strip()) < OCR_MIN_TEXT_LENGTH:
            ocr_text = ocr_page(page)
            if ocr_text:
                page_text = ocr_text

        if page_text:
            all_text.append(page_text)

    doc.close()
    return "\n\n".join(all_text)

def get_text_heading_key(line):
    """
    Kiểm tra xem dòng văn bản có bắt đầu bằng các từ khóa phân cấp hành chính/pháp lý 
    (như PHẦN, CHƯƠNG, MỤC, ĐIỀU) hay không. Trả về mẫu regex khớp hoặc None.
    """
    line = normalize_line(line)

    patterns = [
        r"^PHẦN\s+\d+(?:\.\d+)?(?:[:.]|\s+|$)",
        r"^CHƯƠNG\s+[IVXLC\d]+(?:[:.]|\s+|$)",
        r"^MỤC\s+\d+(?:[:.]|\s+|$)",
        # r"^ĐIỀU\s+\d+(?:[:.]|\s+|$)",
        r"^ĐIỀU\s+\d+(?:[:.]|$)"
    ]

    for pattern in patterns:
        if re.match(pattern, line, re.IGNORECASE):
            return pattern

    return None

def merge_wrapped_lines(text):
    """
    "Hàn gắn" các dòng văn bản bị ngắt xuống dòng vô lý (do chạm mép lề tài liệu gốc).
    Hàm phân tích dấu ngắt câu ở cuối dòng trước và đặc tính của dòng sau để quyết định 
    xem có nên gộp chúng lại thành một câu hoàn chỉnh hay không.
    """
    lines = text.splitlines()
    merged = []
    in_table = False

    for line in lines:
        line = line.strip()

        if not line:
            merged.append("")
            continue

        if line == "[TABLE]":
            in_table = True
            merged.append(line)
            continue

        if line == "[/TABLE]":
            in_table = False
            merged.append(line)
            continue

        if in_table:
            merged.append(line)
            continue

        is_heading = (
            is_table_heading(line)
            or get_text_heading_key(line)
            or re.match(r"^\d+(\.\d+)*\.\s+[A-ZÀ-Ỹ]", line)
        )

        if not merged or not merged[-1]:
            merged.append(line)
            continue

        prev = merged[-1]

        prev_ends_sentence = prev.endswith((".", ":", ";", "!", "?"))
        line_starts_heading = bool(is_heading)

        if not line_starts_heading and not prev_ends_sentence:
            merged[-1] = prev + " " + line
        else:
            merged.append(line)

    return "\n".join(merged)

def parse_number_heading(line):
    """
    Phân tích một dòng văn bản xem nó có phải là tiêu đề đánh số chỉ mục hay không 
    (Ví dụ: "1.1.2. Mục đích"). Trả về một object chứa độ sâu của tiêu đề (dot_depth) 
    và nội dung tiêu đề, hoặc trả về None nếu không khớp.
    """
    line = normalize_line(line)

    match = re.match(r"^(\d+(?:\.\d+)*\.)\s+([A-ZÀ-Ỹ].+)$", line)

    if not match:
        return None

    number = match.group(1).rstrip(".")
    title = match.group(2).strip()

    first = int(number.split(".")[0])
    if first > 50:
        return None

    if len(title) < 3 or len(title) > 120 or len(title.split()) > 25:
        return None

    if title.endswith((".", ",", ";")):
        return None

    parts = [int(x) for x in number.split(".")]

    return {
        "number": number,
        "parts": parts,
        "dot_depth": len(parts),
        "title": title,
    }

def create_node(title, level):
    """
    Tạo một Nút (Node) mới để gắn vào cây cấu trúc tài liệu.
    Mỗi Node đại diện cho một tiêu đề (VD: Chương 1) và sẽ chứa các văn bản con của nó.
    """
    return {
        "title": title,
        "level": level,
        "content_lines": [title] if title else [],
        "children": [],
        "parent": None,
    }

def add_child(parent, child):
    """
    Thiết lập liên kết cha-con giữa 2 Node trong cây cấu trúc.
    """
    child["parent"] = parent
    parent["children"].append(child)

def build_heading_tree(text):
    """
    Hàm cốt lõi: Đọc văn bản từ trên xuống dưới và tự động phân loại, sắp xếp 
    các đoạn văn bản vào một cấu trúc Cây (Tree) dựa trên cấp bậc của các tiêu đề.
    (Ví dụ: Document -> Chương 1 -> Mục 1.1 -> [Văn bản]).
    """
    root = create_node("Document", 0)
    stack = [root]

    text_heading_level = {}
    next_text_level = 1
    current_text_level = 0
    roman_level = 1

    for raw_line in text.splitlines():
        line = normalize_line(raw_line)

        if not line or is_noise_line(line):
            continue

        if line in {"[TABLE]", "[/TABLE]"}:
            stack[-1]["content_lines"].append(line)
            continue

        table_heading = is_table_heading(line)
        text_key = get_text_heading_key(line)
        roman_info = is_roman_heading(line)
        number_info = parse_number_heading(line)

        level = 0

        if table_heading:
            parent_levels = [
                node["level"]
                for node in stack
                if node["title"] != "Document"
                and not is_table_node_title(node["title"])
            ]
            deepest_parent_level = max(parent_levels, default=current_text_level)
            level = deepest_parent_level + 1

        elif text_key:
            if text_key not in text_heading_level:
                text_heading_level[text_key] = next_text_level
                next_text_level += 1

            level = text_heading_level[text_key]
            current_text_level = level

        elif roman_info:
            roman_level = current_text_level + 1
            level = roman_level

        elif number_info:
            level = max(roman_level, current_text_level) + number_info["dot_depth"]

        if level > 0:
            node = create_node(line, level)

            while stack and stack[-1]["level"] >= level:
                stack.pop()

            parent = stack[-1] if stack else root
            add_child(parent, node)
            stack.append(node)
        else:
            stack[-1]["content_lines"].append(line)

    return root

def node_to_text(node):
    """
    Đệ quy lấy toàn bộ văn bản nội dung của một Node hiện tại
    và cộng dồn văn bản của tất cả các Node con cháu của nó.
    """
    parts = []

    own_text = "\n".join(node["content_lines"]).strip()
    if own_text:
        parts.append(own_text)

    for child in node["children"]:
        child_text = node_to_text(child)
        if child_text:
            parts.append(child_text)

    return "\n\n".join(parts).strip()

def get_node_path(node):
    """
    Lấy đường dẫn phân cấp từ gốc đến Node hiện tại.
    (Ví dụ: Trả về mảng ["Document", "Chương 1", "Mục 1.1"]). 
    Dùng để làm metadata lưu ngữ cảnh.
    """
    path = []
    cur = node

    while cur and cur["title"] != "Document":
        path.append(cur["title"])
        cur = cur["parent"]

    return list(reversed(path))

def get_nearest_non_table_parent_title(node):
    """
    Leo ngược lên cây để tìm tiêu đề của Node cha gần nhất mà KHÔNG PHẢI là một bảng biểu.
    Dùng để gắn tên chương/mục vào nội dung của bảng giúp AI giữ được ngữ cảnh.
    """
    cur = node.get("parent")

    while cur and cur.get("title") != "Document":
        title = cur.get("title", "")
        if title and not is_table_node_title(title):
            return title
        cur = cur.get("parent")

    return ""

def contains_table_block(text):
    """
    Kiểm tra nhanh xem đoạn văn bản này có chứa tag [TABLE] hay không.
    """
    return "[TABLE]" in text and "[/TABLE]" in text

def split_long_text(text):
    """
    Hàm chia nhỏ văn bản (Chunking) với giới hạn MAX_CHARS:
    - Nếu đoạn text có chứa bảng, bóc tách bảng ra giữ nguyên vẹn (không bao giờ cắt đôi bảng), chỉ cắt text xung quanh.
    - Nếu là text bình thường, cắt theo từng đoạn văn (paragraph) và giữ lại 1 phần gối đầu (overlap) để không mất ngữ cảnh.
    """
    text = text.strip()

    if not text:
        return []

    if len(text) <= MAX_CHARS:
        return [text]
 
    if contains_table_block(text):
        table_pattern = re.compile(
            r"(?:\[PAGE\s+\d+\s+-\s+TABLE\s+\d+\]\s*)?\[TABLE\].*?\[/TABLE\]",
            re.IGNORECASE | re.DOTALL
        )

        chunks = []
        last_end = 0

        for match in table_pattern.finditer(text):
            before = text[last_end:match.start()].strip()
            table_block = match.group(0).strip()

            if before:
                chunks.extend(split_long_text(before))

            if table_block:
                chunks.append(table_block)

            last_end = match.end()

        after = text[last_end:].strip()
        if after:
            chunks.extend(split_long_text(after))

        return chunks

    blocks = re.split(r"\n\s*\n", text)

    if len(blocks) == 1:
        blocks = text.splitlines()

    chunks = []
    current_blocks = []
    current_len = 0

    for block in blocks:
        block = block.strip()
        if not block:
            continue

        block_len = len(block)

        if current_blocks and current_len + block_len + 2 > MAX_CHARS:
            chunks.append("\n\n".join(current_blocks).strip())
            overlap = current_blocks[-OVERLAP_BLOCKS:] if OVERLAP_BLOCKS > 0 else []
            current_blocks = overlap + [block]
            current_len = sum(len(x) for x in current_blocks)
        else:
            current_blocks.append(block)
            current_len += block_len + 2

    if current_blocks:
        chunks.append("\n\n".join(current_blocks).strip())

    return chunks

def emit_chunks_from_node(node):
    """
    Duyệt đệ quy qua cây cấu trúc tài liệu. 
    Lấy văn bản của từng Node, nếu dài quá thì gọi hàm `split_long_text` để cắt.
    Đặc biệt: Tự động chèn tên tiêu đề của Node cha lên đầu mỗi đoạn chunk bị cắt 
    để đảm bảo khi lưu trữ độc lập, đoạn chunk đó vẫn mang đủ ngữ cảnh.
    """
    chunks = []

    if node["title"] == "Document":
        for child in node["children"]:
            chunks.extend(emit_chunks_from_node(child))

        if not node["children"]:
            text = node_to_text(node)
            for sub in split_long_text(text):
                chunks.append({
                    "title": node["title"],
                    "path": [],
                    "content": sub
                })

        return chunks

    full_text = node_to_text(node)
    path = get_node_path(node)

    if is_table_node_title(node["title"]):
        parent_title = get_nearest_non_table_parent_title(node)

        if parent_title and parent_title not in full_text:
            full_text = parent_title + "\n\n" + full_text

        chunks.append({
            "title": node["title"],
            "path": path,
            "content": full_text
        })
        return chunks

    if len(full_text) <= MAX_CHARS:
        chunks.append({
            "title": node["title"],
            "path": path,
            "content": full_text
        })
        return chunks

    if node["children"]:
        own_text = "\n".join(node["content_lines"]).strip()

        if own_text and len(own_text) > len(node["title"]):
            own_parts = split_long_text(own_text)
            for part in own_parts:
                chunks.append({
                    "title": node["title"],
                    "path": path,
                    "content": part
                })

        for child in node["children"]:
            child_chunks = emit_chunks_from_node(child)
            for child_chunk in child_chunks:
                if node["title"] not in child_chunk["content"]:
                    child_chunk["content"] = node["title"] + "\n\n" + child_chunk["content"]
                chunks.append(child_chunk)

        return chunks

    parts = split_long_text(full_text)
    for part in parts:
        if node["title"] not in part:
            part = node["title"] + "\n\n" + part
        chunks.append({
            "title": node["title"],
            "path": path,
            "content": part
        })

    return chunks


def build_chunks(input_file):
    """
    Hàm tổng hợp toàn bộ quy trình:
    1. Trích xuất text từ PDF.
    2. Nối dòng đứt gãy.
    3. Dựng cây cấu trúc.
    4. Cắt thành các chunks nhỏ.
    5. Đóng gói kết quả thành định dạng danh sách các Dictionary chuẩn bị xuất ra JSON.
    """
    text = extract_pdf_text(input_file)
    text = merge_wrapped_lines(text)

    root = build_heading_tree(text)
    raw_chunks = emit_chunks_from_node(root)

    chunks = []
    for idx, item in enumerate(raw_chunks, start=1):
        chunks.append({
            "chunk_id": idx,
            "content": item["content"],
            "metadata": {
                "source": input_file.split('/')[-1] if '/' in input_file else input_file.split('\\')[-1],
                "section_title": item["title"],
                "section_path": item["path"],
                "section_index": idx,
                "sub_chunk_index": 1,
                "parser": "pymupdf_easyocr_table_atomic_parent_heading_trim_return_overflow"
            }
        })

    return chunks


def main():
    # 1. Nhận đường dẫn file PDF từ Node.js truyền sang
    if len(sys.argv) < 2:
        # Báo lỗi về Node.js (stderr) nếu thiếu argument
        sys.stderr.write(json.dumps({"error": "Missing PDF filepath argument"}))
        sys.exit(1)

    input_file = sys.argv[1]

    try:
        # 2. Xử lý file PDF thành mảng chunk
        chunks = build_chunks(input_file)

        # 3. CHỈ IN RA DUY NHẤT CHUỖI JSON ĐỂ NODE.JS LẤY KẾT QUẢ
        print(json.dumps(chunks, ensure_ascii=False))
        sys.exit(0)
    except Exception as e:
        sys.stderr.write(json.dumps({"error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()