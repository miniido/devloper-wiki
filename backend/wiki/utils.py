def extract_block_text(blocks):
    """BlockNote JSON에서 검색 가능한 텍스트만 추출한다."""

    texts = []

    def visit(node):
        if isinstance(node, list):
            for item in node:
                visit(item)

        elif isinstance(node, dict):
            if node.get("type") == "text":
                text = node.get("text", "")
                if isinstance(text, str):
                    texts.append(text)

            # 링크, 테이블 셀 등 내부 콘텐츠도 순회
            for key, value in node.items():
                if key in ("content", "children", "rows", "cells"):
                    visit(value)

    visit(blocks)
    return " ".join(texts)