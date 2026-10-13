#!/usr/bin/env python3
"""
Generate a Premium Computer Networks Project Presentation for MicroburstHunter.
Adheres strictly to all styling, typography, content, and quality requirements.
"""

import os
import pptx
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE

# -----------------------------------------------------------------------------
# CONSTANTS & PALETTE
# -----------------------------------------------------------------------------
COLOR_BG_DARK       = RGBColor(10, 15, 29)      # Deep Midnight Navy
COLOR_BG_CARD       = RGBColor(16, 26, 48)      # Card / Container Navy
COLOR_CARD_BORDER   = RGBColor(28, 48, 86)      # Subtle Slate Blue Border
COLOR_CYAN_ACCENT   = RGBColor(0, 229, 255)     # Vibrant Electric Cyan
COLOR_BLUE_ACCENT   = RGBColor(59, 130, 246)    # Modern Blue
COLOR_RED_ACCENT    = RGBColor(239, 68, 68)     # Controlled Red Warning
COLOR_GREEN_ACCENT  = RGBColor(34, 197, 94)     # Success / Normal Green
COLOR_AMBER_ACCENT  = RGBColor(245, 158, 11)    # Amber Decision
COLOR_WHITE         = RGBColor(255, 255, 255)   # Pure White
COLOR_TEXT_MUTED    = RGBColor(148, 163, 184)   # Slate Grey Subtitle
COLOR_TEXT_DIM      = RGBColor(203, 213, 225)   # Off-White Body

FONT_FAMILY = "Segoe UI"

COVER_IMG_PATH = r"C:\Users\Mohd Arshad Ali\.gemini\antigravity-ide\brain\bc1499b1-3937-47aa-8d2d-86ea880b3e79\datacenter_microburst_cover_1791809415975.jpg"
DIAGRAM_IMG_PATH = r"C:\Users\Mohd Arshad Ali\.gemini\antigravity-ide\brain\bc1499b1-3937-47aa-8d2d-86ea880b3e79\microburst_traffic_diagram_1791809436518.jpg"
CLOSING_IMG_PATH = r"C:\Users\Mohd Arshad Ali\.gemini\antigravity-ide\brain\bc1499b1-3937-47aa-8d2d-86ea880b3e79\datacenter_closing_visual_1791809456344.jpg"

OUTPUT_PPTX = r"C:\Users\Mohd Arshad Ali\.gemini\antigravity-ide\scratch\MICROBUSRTHUNTER\MicroburstHunter_Presentation.pptx"

# -----------------------------------------------------------------------------
# HELPER FUNCTIONS
# -----------------------------------------------------------------------------
def set_slide_background(slide, prs):
    bg = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, prs.slide_height)
    bg.fill.solid()
    bg.fill.fore_color.rgb = COLOR_BG_DARK
    bg.line.fill.background()
    return bg

def add_header(slide, title_text, category_text="COURSE BASED PROJECT  |  COMPUTER NETWORKS"):
    # Category Tracker / Top Tag
    cat_box = slide.shapes.add_textbox(Inches(0.8), Inches(0.4), Inches(11.5), Inches(0.35))
    tf_cat = cat_box.text_frame
    tf_cat.word_wrap = True
    tf_cat.margin_left = tf_cat.margin_top = tf_cat.margin_right = tf_cat.margin_bottom = 0
    p_cat = tf_cat.paragraphs[0]
    p_cat.text = category_text.upper()
    p_cat.font.name = FONT_FAMILY
    p_cat.font.size = Pt(9.5)
    p_cat.font.bold = True
    p_cat.font.color.rgb = COLOR_CYAN_ACCENT

    # Main Title
    title_box = slide.shapes.add_textbox(Inches(0.8), Inches(0.72), Inches(11.5), Inches(0.65))
    tf_title = title_box.text_frame
    tf_title.word_wrap = True
    tf_title.margin_left = tf_title.margin_top = tf_title.margin_right = tf_title.margin_bottom = 0
    p_title = tf_title.paragraphs[0]
    p_title.text = title_text
    p_title.font.name = FONT_FAMILY
    p_title.font.size = Pt(24)
    p_title.font.bold = True
    p_title.font.color.rgb = COLOR_WHITE

    # Glowing subtle rule under header
    line = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.8), Inches(1.42), Inches(11.733), Pt(1.5))
    line.fill.solid()
    line.fill.fore_color.rgb = COLOR_CARD_BORDER
    line.line.fill.background()

def create_card(slide, left, top, width, height, bg_color=COLOR_BG_CARD, border_color=COLOR_CARD_BORDER, border_width=1.0):
    card = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, left, top, width, height)
    card.fill.solid()
    card.fill.fore_color.rgb = bg_color
    if border_color:
        card.line.color.rgb = border_color
        card.line.width = Pt(border_width)
    else:
        card.line.fill.background()
    return card

# -----------------------------------------------------------------------------
# PRESENTATION GENERATOR
# -----------------------------------------------------------------------------
def build_presentation():
    prs = pptx.Presentation()
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)
    blank_layout = prs.slide_layouts[6]

    # =========================================================================
    # SLIDE 1: CINEMATIC PROJECT COVER
    # =========================================================================
    slide1 = prs.slides.add_slide(blank_layout)
    set_slide_background(slide1, prs)

    # Right Side Cinematic Image
    if os.path.exists(COVER_IMG_PATH):
        img_left = Inches(5.8)
        img_top = Inches(0.0)
        img_width = Inches(7.533)
        img_height = Inches(7.5)
        slide1.shapes.add_picture(COVER_IMG_PATH, img_left, img_top, img_width, img_height)

        # Gradient overlay on image edge to seamlessly blend with left dark panel
        vignette = slide1.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(5.5), Inches(0), Inches(1.2), Inches(7.5))
        vignette.fill.solid()
        vignette.fill.fore_color.rgb = COLOR_BG_DARK
        vignette.line.fill.background()

    # Left Container Card / Vignette
    left_panel = slide1.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0), Inches(0), Inches(5.8), Inches(7.5))
    left_panel.fill.solid()
    left_panel.fill.fore_color.rgb = COLOR_BG_DARK
    left_panel.line.fill.background()

    # Category Pill
    pill = slide1.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.8), Inches(0.8), Inches(4.3), Inches(0.42))
    pill.fill.solid()
    pill.fill.fore_color.rgb = RGBColor(16, 32, 60)
    pill.line.color.rgb = COLOR_CYAN_ACCENT
    pill.line.width = Pt(1.2)
    tf_pill = pill.text_frame
    tf_pill.vertical_anchor = MSO_ANCHOR.MIDDLE
    p_pill = tf_pill.paragraphs[0]
    p_pill.text = "COURSE BASED PROJECT  |  COMPUTER NETWORKS"
    p_pill.font.name = FONT_FAMILY
    p_pill.font.size = Pt(10)
    p_pill.font.bold = True
    p_pill.font.color.rgb = COLOR_CYAN_ACCENT
    p_pill.alignment = PP_ALIGN.CENTER

    # Title & Subtitle Box
    title_box = slide1.shapes.add_textbox(Inches(0.8), Inches(1.4), Inches(4.8), Inches(2.8))
    tf_t = title_box.text_frame
    tf_t.word_wrap = True
    tf_t.margin_left = tf_t.margin_top = tf_t.margin_right = tf_t.margin_bottom = 0

    p_main = tf_t.paragraphs[0]
    p_main.text = "MicroburstHunter"
    p_main.font.name = FONT_FAMILY
    p_main.font.size = Pt(40)
    p_main.font.bold = True
    p_main.font.color.rgb = COLOR_WHITE
    p_main.space_after = Pt(12)

    p_sub = tf_t.add_paragraph()
    p_sub.text = "Real-Time Detection and Adaptive Mitigation of Microbursts in Data Center Networks"
    p_sub.font.name = FONT_FAMILY
    p_sub.font.size = Pt(14)
    p_sub.font.bold = True
    p_sub.font.color.rgb = COLOR_CYAN_ACCENT
    p_sub.space_after = Pt(14)

    p_desc = tf_t.add_paragraph()
    p_desc.text = "Sub-RTT algorithmic telemetry, dynamic EWMA baseline thresholding, Linux HTB egress traffic control, and fail-closed safety orchestration."
    p_desc.font.name = FONT_FAMILY
    p_desc.font.size = Pt(11.5)
    p_desc.font.color.rgb = COLOR_TEXT_MUTED

    # Team Members Card
    team_card = create_card(slide1, Inches(0.8), Inches(4.6), Inches(4.8), Inches(2.2), bg_color=COLOR_BG_CARD, border_color=COLOR_CARD_BORDER)
    tf_team = team_card.text_frame
    tf_team.word_wrap = True
    tf_team.margin_left = Inches(0.3)
    tf_team.margin_top = Inches(0.2)
    tf_team.margin_right = Inches(0.3)
    tf_team.margin_bottom = Inches(0.2)

    p_head = tf_team.paragraphs[0]
    p_head.text = "PROJECT TEAM (DEPARTMENT OF CSE)"
    p_head.font.name = FONT_FAMILY
    p_head.font.size = Pt(10)
    p_head.font.bold = True
    p_head.font.color.rgb = COLOR_CYAN_ACCENT
    p_head.space_after = Pt(10)

    members = [
        ("K AKSHITH REDDY", "1602-24-737-088"),
        ("MD ARSALAANUDDIN", "1602-24-737-087"),
        ("MD ARSHAD ALI", "1602-24-737-088")
    ]
    for name, roll in members:
        pm = tf_team.add_paragraph()
        pm.text = f"{name}  |  {roll}"
        pm.font.name = FONT_FAMILY
        pm.font.size = Pt(11)
        pm.font.bold = True
        pm.font.color.rgb = COLOR_WHITE
        pm.space_after = Pt(5)

    # =========================================================================
    # SLIDE 2: PROBLEM STATEMENT AND ABSTRACT
    # =========================================================================
    slide2 = prs.slides.add_slide(blank_layout)
    set_slide_background(slide2, prs)
    add_header(slide2, "Problem Statement & Abstract")

    # Left Section: Problem Statement Card
    prob_card = create_card(slide2, Inches(0.8), Inches(1.65), Inches(5.6), Inches(5.35))
    tf_prob = prob_card.text_frame
    tf_prob.word_wrap = True
    tf_prob.margin_left = Inches(0.35)
    tf_prob.margin_top = Inches(0.3)
    tf_prob.margin_right = Inches(0.35)
    tf_prob.margin_bottom = Inches(0.3)

    p_ph = tf_prob.paragraphs[0]
    p_ph.text = "PROBLEM STATEMENT"
    p_ph.font.name = FONT_FAMILY
    p_ph.font.size = Pt(12)
    p_ph.font.bold = True
    p_ph.font.color.rgb = COLOR_RED_ACCENT
    p_ph.space_after = Pt(8)

    p_pintro = tf_prob.add_paragraph()
    p_pintro.text = "Modern data-center networks experience sudden, short-duration traffic bursts (microbursts). These surges overwhelm switch memory buffers, drive queue buildup, elevate tail latency, and induce packet drops."
    p_pintro.font.name = FONT_FAMILY
    p_pintro.font.size = Pt(11.5)
    p_pintro.font.color.rgb = COLOR_TEXT_DIM
    p_pintro.space_after = Pt(16)

    # 4 Key Points Cards within Left Panel
    points = [
        ("Sudden Traffic Spikes & Transient Congestion", "Incast events and synchronized tenant traffic overload shallow switch queues in milliseconds."),
        ("Increased Latency & Potential Packet Drops", "Queue exhaustion causes severe tail latency and catastrophic tail-drops before TCP reacts."),
        ("Monitoring Intervals May Hide Short Bursts", "Traditional SNMP/sFlow telemetry (1–30s) averages out sub-second microbursts entirely."),
        ("Need for Timely Detection & Controlled Mitigation", "Requires real-time 10 ms resolution with automated, non-disruptive rate shaping.")
    ]
    for title, desc in points:
        pt = tf_prob.add_paragraph()
        pt.text = f"▶  {title}"
        pt.font.name = FONT_FAMILY
        pt.font.size = Pt(11.5)
        pt.font.bold = True
        pt.font.color.rgb = COLOR_CYAN_ACCENT
        pt.space_after = Pt(2)

        pd = tf_prob.add_paragraph()
        pd.text = f"     {desc}"
        pd.font.name = FONT_FAMILY
        pd.font.size = Pt(10.5)
        pd.font.color.rgb = COLOR_TEXT_MUTED
        pd.space_after = Pt(8)

    # Right Upper Section: Abstract Card
    abs_card = create_card(slide2, Inches(6.7), Inches(1.65), Inches(5.8), Inches(2.35))
    tf_abs = abs_card.text_frame
    tf_abs.word_wrap = True
    tf_abs.margin_left = Inches(0.35)
    tf_abs.margin_top = Inches(0.25)
    tf_abs.margin_right = Inches(0.35)
    tf_abs.margin_bottom = Inches(0.25)

    p_ah = tf_abs.paragraphs[0]
    p_ah.text = "PROJECT ABSTRACT"
    p_ah.font.name = FONT_FAMILY
    p_ah.font.size = Pt(12)
    p_ah.font.bold = True
    p_ah.font.color.rgb = COLOR_CYAN_ACCENT
    p_ah.space_after = Pt(8)

    p_abody = tf_abs.add_paragraph()
    p_abody.text = "“MicroburstHunter is a real-time microburst detection and adaptive mitigation system for data-center networks. It evaluates traffic in short time windows, establishes a traffic baseline, detects sustained anomalies, ranks major contributing sources, and selects a mitigation policy. Linux traffic control supports rate shaping, while recovery logic and watchdog handling bound mitigation duration. SQLite records lifecycle events for auditing. The system supports a safe dry-run mode and isolated Linux kernel-shaping validation.”"
    p_abody.font.name = FONT_FAMILY
    p_abody.font.size = Pt(11)
    p_abody.font.italic = True
    p_abody.font.color.rgb = COLOR_TEXT_DIM

    # Right Lower Section: Generated Technical Diagram Image Card
    if os.path.exists(DIAGRAM_IMG_PATH):
        img_card = create_card(slide2, Inches(6.7), Inches(4.15), Inches(5.8), Inches(2.85), bg_color=COLOR_BG_CARD, border_color=COLOR_CARD_BORDER)
        # Embed image centered inside card
        slide2.shapes.add_picture(DIAGRAM_IMG_PATH, Inches(6.75), Inches(4.2), Inches(5.7), Inches(2.75))

    # =========================================================================
    # SLIDE 3: EXISTING SOLUTIONS VS PROPOSED SOLUTION
    # =========================================================================
    slide3 = prs.slides.add_slide(blank_layout)
    set_slide_background(slide3, prs)
    add_header(slide3, "Existing Approaches vs Proposed Solution")

    # Left Column: Existing Approaches Card (Red Accent Border)
    left_comp = create_card(slide3, Inches(0.8), Inches(1.65), Inches(5.7), Inches(3.2), bg_color=COLOR_BG_CARD, border_color=COLOR_RED_ACCENT, border_width=1.2)
    tf_lc = left_comp.text_frame
    tf_lc.word_wrap = True
    tf_lc.margin_left = Inches(0.35)
    tf_lc.margin_top = Inches(0.25)
    tf_lc.margin_right = Inches(0.35)
    tf_lc.margin_bottom = Inches(0.25)

    p_lh = tf_lc.paragraphs[0]
    p_lh.text = "TRADITIONAL APPROACHES & LIMITATIONS"
    p_lh.font.name = FONT_FAMILY
    p_lh.font.size = Pt(12)
    p_lh.font.bold = True
    p_lh.font.color.rgb = COLOR_RED_ACCENT
    p_lh.space_after = Pt(10)

    trad_points = [
        "Traditional monitoring relies on coarse, aggregated periodic averages.",
        "Coarse sampling intervals (1–30s) obscure short-lived sub-second bursts.",
        "Reactive congestion controls respond only after switch buffer overflows.",
        "Static rate limits fail to adapt dynamically to shifting baseline traffic.",
        "Detection, mitigation, recovery, and audit evidence remain fragmented."
    ]
    for pt in trad_points:
        p = tf_lc.add_paragraph()
        p.text = f"✖  {pt}"
        p.font.name = FONT_FAMILY
        p.font.size = Pt(11)
        p.font.color.rgb = COLOR_TEXT_DIM
        p.space_after = Pt(6)

    # Right Column: Proposed Solution Card (Cyan Accent Border)
    right_comp = create_card(slide3, Inches(6.8), Inches(1.65), Inches(5.7), Inches(3.2), bg_color=COLOR_BG_CARD, border_color=COLOR_CYAN_ACCENT, border_width=1.5)
    tf_rc = right_comp.text_frame
    tf_rc.word_wrap = True
    tf_rc.margin_left = Inches(0.35)
    tf_rc.margin_top = Inches(0.25)
    tf_rc.margin_right = Inches(0.35)
    tf_rc.margin_bottom = Inches(0.25)

    p_rh = tf_rc.paragraphs[0]
    p_rh.text = "PROPOSED SOLUTION — MICROBURSTHUNTER"
    p_rh.font.name = FONT_FAMILY
    p_rh.font.size = Pt(12)
    p_rh.font.bold = True
    p_rh.font.color.rgb = COLOR_CYAN_ACCENT
    p_rh.space_after = Pt(10)

    prop_points = [
        "10 ms high-resolution evaluation windows for fine-grained telemetry.",
        "Dynamic EWMA baseline with 3× multiplier and 80 Mbps floor threshold.",
        "Persistence filtering (2–3 windows) prevents false triggers on spikes.",
        "Automated per-flow source ranking isolates top offending sender IPs.",
        "Targeted, bounded Linux tc / HTB rate shaping (35 Mbps severe cap).",
        "Deterministic recovery, watchdog timer ceiling, and SQLite audit log."
    ]
    for pt in prop_points:
        p = tf_rc.add_paragraph()
        p.text = f"✔  {pt}"
        p.font.name = FONT_FAMILY
        p.font.size = Pt(11)
        p.font.color.rgb = COLOR_TEXT_DIM
        p.space_after = Pt(5)

    # Lower Section: Sophisticated Comparison Table
    table_card = create_card(slide3, Inches(0.8), Inches(5.05), Inches(11.7), Inches(1.95), bg_color=COLOR_BG_CARD, border_color=COLOR_CARD_BORDER)
    
    rows, cols = 4, 3
    t_shape = slide3.shapes.add_table(rows, cols, Inches(1.0), Inches(5.15), Inches(11.3), Inches(1.75))
    table = t_shape.table
    table.columns[0].width = Inches(2.6)
    table.columns[1].width = Inches(4.35)
    table.columns[2].width = Inches(4.35)

    headers = ["Capability Dimension", "Traditional Approach", "MicroburstHunter Prototype"]
    for i, h in enumerate(headers):
        cell = table.cell(0, i)
        cell.text = h
        cell.fill.solid()
        cell.fill.fore_color.rgb = RGBColor(20, 35, 65)
        p = cell.text_frame.paragraphs[0]
        p.font.name = FONT_FAMILY
        p.font.size = Pt(11)
        p.font.bold = True
        p.font.color.rgb = COLOR_CYAN_ACCENT

    data = [
        ("Telemetry Resolution", "1 to 30 seconds (SNMP, NetFlow, sFlow polling)", "10 ms high-frequency software window aggregation"),
        ("Reaction Speed", "Coarse reactive pacing; detects only post-buffer loss", "Real-time algorithmic persistence check (<15 μs software latency)"),
        ("Mitigation & Safety", "Static port throttling; risk of persistent lockouts", "Targeted per-source HTB cap, watchdog timer, dry-run by default")
    ]
    for r_idx, row in enumerate(data, start=1):
        for c_idx, val in enumerate(row):
            cell = table.cell(r_idx, c_idx)
            cell.text = val
            cell.fill.solid()
            cell.fill.fore_color.rgb = COLOR_BG_CARD if r_idx % 2 == 1 else RGBColor(18, 30, 54)
            p = cell.text_frame.paragraphs[0]
            p.font.name = FONT_FAMILY
            p.font.size = Pt(10)
            p.font.color.rgb = COLOR_WHITE if c_idx == 0 else COLOR_TEXT_DIM

    # =========================================================================
    # SLIDE 4: SYSTEM ARCHITECTURE DIAGRAM (EDITABLE VECTOR PIPELINE)
    # =========================================================================
    slide4 = prs.slides.add_slide(blank_layout)
    set_slide_background(slide4, prs)
    add_header(slide4, "MicroburstHunter — System Architecture")

    # Pipeline Cards Coordinates: 7 stages laid out horizontally
    # Left-to-right flow with arrows
    stages = [
        ("Network Traffic", "Incoming packets\n& live captures", COLOR_BLUE_ACCENT),
        ("Packet Capture", "Raw socket &\npcap observation", COLOR_BLUE_ACCENT),
        ("Window Processor", "Aggregates into\n10 ms windows", COLOR_CYAN_ACCENT),
        ("Burst Detector", "EWMA baseline\n3x mult, 80M floor", COLOR_AMBER_ACCENT),
        ("Source Ranker", "Identifies top\noffending flow IP", COLOR_AMBER_ACCENT),
        ("Mitigation Policy", "Selects rate cap\n(35 Mbps severe)", COLOR_RED_ACCENT),
        ("Traffic Control", "Linux tc / HTB\nDry-run default", COLOR_RED_ACCENT),
        ("Event Store", "SQLite persistence\naudit trail", COLOR_GREEN_ACCENT)
    ]

    card_w = Inches(1.22)
    card_h = Inches(2.2)
    start_x = Inches(0.8)
    spacing_x = Inches(1.48)
    top_y = Inches(1.8)

    for idx, (s_name, s_desc, accent_color) in enumerate(stages):
        cur_x = start_x + (idx * spacing_x)
        # Component Box
        c_box = slide4.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, cur_x, top_y, card_w, card_h)
        c_box.fill.solid()
        c_box.fill.fore_color.rgb = COLOR_BG_CARD
        c_box.line.color.rgb = accent_color
        c_box.line.width = Pt(1.5)

        tf_c = c_box.text_frame
        tf_c.word_wrap = True
        tf_c.margin_left = tf_c.margin_right = Inches(0.08)
        tf_c.margin_top = Inches(0.15)

        # Stage Number Badge
        p_num = tf_c.paragraphs[0]
        p_num.text = f"STAGE {idx+1}"
        p_num.font.name = FONT_FAMILY
        p_num.font.size = Pt(8.5)
        p_num.font.bold = True
        p_num.font.color.rgb = accent_color
        p_num.alignment = PP_ALIGN.CENTER
        p_num.space_after = Pt(6)

        # Stage Title
        p_name = tf_c.add_paragraph()
        p_name.text = s_name
        p_name.font.name = FONT_FAMILY
        p_name.font.size = Pt(10.5)
        p_name.font.bold = True
        p_name.font.color.rgb = COLOR_WHITE
        p_name.alignment = PP_ALIGN.CENTER
        p_name.space_after = Pt(8)

        # Stage Description
        p_desc = tf_c.add_paragraph()
        p_desc.text = s_desc
        p_desc.font.name = FONT_FAMILY
        p_desc.font.size = Pt(9.5)
        p_desc.font.color.rgb = COLOR_TEXT_MUTED
        p_desc.alignment = PP_ALIGN.CENTER

        # Directional Arrow between cards (except last card)
        if idx < len(stages) - 1:
            arrow = slide4.shapes.add_shape(MSO_SHAPE.RIGHT_ARROW, cur_x + card_w + Inches(0.04), top_y + Inches(0.9), Inches(0.18), Inches(0.35))
            arrow.fill.solid()
            arrow.fill.fore_color.rgb = COLOR_CYAN_ACCENT
            arrow.line.fill.background()

    # Recovery Manager & Watchdog Component (Beneath Main Pipeline)
    recov_card = create_card(slide4, Inches(4.5), Inches(4.4), Inches(5.8), Inches(1.4), bg_color=COLOR_BG_CARD, border_color=COLOR_GREEN_ACCENT, border_width=1.5)
    tf_rec = recov_card.text_frame
    tf_rec.word_wrap = True
    tf_rec.margin_left = Inches(0.3)
    tf_rec.margin_top = Inches(0.15)
    tf_rec.margin_right = Inches(0.3)
    
    p_rech = tf_rec.paragraphs[0]
    p_rech.text = "RECOVERY MANAGER & TIMEOUT WATCHDOG  (CONTROL / FEEDBACK PATH)"
    p_rech.font.name = FONT_FAMILY
    p_rech.font.size = Pt(11)
    p_rech.font.bold = True
    p_rech.font.color.rgb = COLOR_GREEN_ACCENT
    p_rech.space_after = Pt(4)

    p_recb = tf_rec.add_paragraph()
    p_recb.text = "• Quiet-Window Recovery: Automatically clears mitigation after 3–10 quiet consecutive 10 ms windows.\n• Inactivity Watchdog: Monotonic wall-clock timer (250 ms demo / 8,000 ms prod) releases rules on idle traffic.\n• Generation Tracking: Protects against stale timer callbacks and asynchronous netlink race conditions."
    p_recb.font.name = FONT_FAMILY
    p_recb.font.size = Pt(10)
    p_recb.font.color.rgb = COLOR_TEXT_DIM

    # Upward Feedback Arrows connecting Recovery Manager to Mitigation Policy & Traffic Control
    up_arrow = slide4.shapes.add_shape(MSO_SHAPE.UP_ARROW, Inches(8.5), Inches(4.05), Inches(0.3), Inches(0.32))
    up_arrow.fill.solid()
    up_arrow.fill.fore_color.rgb = COLOR_GREEN_ACCENT
    up_arrow.line.fill.background()

    # Safety Guard & Invariants Box (Left Lower Corner)
    guard_card = create_card(slide4, Inches(0.8), Inches(4.4), Inches(3.5), Inches(1.4), bg_color=RGBColor(24, 18, 28), border_color=COLOR_AMBER_ACCENT, border_width=1.2)
    tf_g = guard_card.text_frame
    tf_g.word_wrap = True
    tf_g.margin_left = Inches(0.25)
    tf_g.margin_top = Inches(0.15)
    tf_g.margin_right = Inches(0.25)

    p_gh = tf_g.paragraphs[0]
    p_gh.text = "FAIL-CLOSED SAFETY GUARDS"
    p_gh.font.name = FONT_FAMILY
    p_gh.font.size = Pt(10.5)
    p_gh.font.bold = True
    p_gh.font.color.rgb = COLOR_AMBER_ACCENT
    p_gh.space_after = Pt(4)

    p_gb = tf_g.add_paragraph()
    p_gb.text = "• Dry-run enabled by default (0 netlink mutations).\n• Live shaping requires dual authorization gates.\n• eth0, lo, and host default route strictly forbidden."
    p_gb.font.name = FONT_FAMILY
    p_gb.font.size = Pt(9.5)
    p_gb.font.color.rgb = COLOR_TEXT_DIM

    # System Performance & Metrics Strip (Right Lower Corner)
    perf_card = create_card(slide4, Inches(10.5), Inches(4.4), Inches(2.0), Inches(1.4), bg_color=COLOR_BG_CARD, border_color=COLOR_BLUE_ACCENT, border_width=1.2)
    tf_p = perf_card.text_frame
    tf_p.word_wrap = True
    tf_p.margin_left = tf_p.margin_right = Inches(0.15)
    tf_p.margin_top = Inches(0.15)
    p_ph = tf_p.paragraphs[0]
    p_ph.text = "PERFORMANCE"
    p_ph.font.name = FONT_FAMILY
    p_ph.font.size = Pt(10.5)
    p_ph.font.bold = True
    p_ph.font.color.rgb = COLOR_BLUE_ACCENT
    p_ph.space_after = Pt(4)
    p_pb = tf_p.add_paragraph()
    p_pb.text = "• <15 µs Software Latency\n• 0 False Positives / 1000w\n• 100% Burst Detection\n• 2.9% Live Shaping Error"
    p_pb.font.name = FONT_FAMILY
    p_pb.font.size = Pt(9.5)
    p_pb.font.color.rgb = COLOR_TEXT_DIM

    # Bottom Architecture Summary Note
    note_box = slide4.shapes.add_textbox(Inches(0.8), Inches(6.05), Inches(11.7), Inches(0.8))
    tf_n = note_box.text_frame
    tf_n.word_wrap = True
    p_n = tf_n.paragraphs[0]
    p_n.text = "Data Flow: Ingress Traffic → High-Frequency Window Aggregation → Algorithmic Detection → Adaptive HTB Shaping → SQLite Audit.\nControl Flow: Recovery Manager continuously monitors traffic normalization and wall-clock inactivity to trigger automatic de-escalation."
    p_n.font.name = FONT_FAMILY
    p_n.font.size = Pt(10)
    p_n.font.color.rgb = COLOR_TEXT_MUTED
    p_n.alignment = PP_ALIGN.CENTER

    # =========================================================================
    # SLIDE 5: PROJECT WORKFLOW FLOWCHART
    # =========================================================================
    slide5 = prs.slides.add_slide(blank_layout)
    set_slide_background(slide5, prs)
    add_header(slide5, "How MicroburstHunter Works — Operational Workflow")

    # Top Visual Lifecycle Strip: Baseline -> Burst -> Mitigation -> Recovery
    strip_w = Inches(2.7)
    strip_h = Inches(0.55)
    strip_y = Inches(1.6)
    strip_stages = [
        ("1. BASELINE (15 Mbps)", "EWMA establishes 80M threshold", COLOR_BLUE_ACCENT, Inches(0.8)),
        ("2. BURST (150 Mbps)", "2-window persistence triggered", COLOR_RED_ACCENT, Inches(3.8)),
        ("3. MITIGATION (35 Mbps)", "HTB class 1:10 cap applied", COLOR_AMBER_ACCENT, Inches(6.8)),
        ("4. RECOVERY (Normal)", "3 quiet windows / watchdog expiry", COLOR_GREEN_ACCENT, Inches(9.8))
    ]
    for st_title, st_sub, col, st_x in strip_stages:
        s_box = slide5.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, st_x, strip_y, strip_w, strip_h)
        s_box.fill.solid()
        s_box.fill.fore_color.rgb = COLOR_BG_CARD
        s_box.line.color.rgb = col
        s_box.line.width = Pt(1.5)
        tf_s = s_box.text_frame
        tf_s.word_wrap = True
        tf_s.margin_top = Inches(0.06)
        p1 = tf_s.paragraphs[0]
        p1.text = st_title
        p1.font.name = FONT_FAMILY
        p1.font.size = Pt(10)
        p1.font.bold = True
        p1.font.color.rgb = col
        p1.alignment = PP_ALIGN.CENTER
        p2 = tf_s.add_paragraph()
        p2.text = st_sub
        p2.font.name = FONT_FAMILY
        p2.font.size = Pt(8.5)
        p2.font.color.rgb = COLOR_TEXT_MUTED
        p2.alignment = PP_ALIGN.CENTER

    # Flowchart Blocks: 3 columns layout for clean flow without cramped boxes
    # Column 1: Ingestion & Threshold Check (Left)
    col1_card = create_card(slide5, Inches(0.8), Inches(2.4), Inches(3.6), Inches(4.55))
    tf_c1 = col1_card.text_frame
    tf_c1.word_wrap = True
    tf_c1.margin_left = Inches(0.25)
    tf_c1.margin_top = Inches(0.2)
    tf_c1.margin_right = Inches(0.25)

    p_c1h = tf_c1.paragraphs[0]
    p_c1h.text = "1. INGESTION & THRESHOLDING"
    p_c1h.font.name = FONT_FAMILY
    p_c1h.font.size = Pt(11)
    p_c1h.font.bold = True
    p_c1h.font.color.rgb = COLOR_CYAN_ACCENT
    p_c1h.space_after = Pt(10)

    c1_steps = [
        ("Start Passive Capture", "Continuous socket observation on targeted network interface."),
        ("10 ms Window Aggregator", "Aggregates byte & packet counters into strict 10 ms slices."),
        ("EWMA Baseline Tracker", "Calculates dynamic rolling baseline: B_t = α·R_t + (1-α)·B_{t-1}."),
        ("Adaptive Threshold Floor", "Threshold T = max(80 Mbps, 3.0 × Baseline). Prevents noise triggers."),
        ("Persistence Check [Decision]", "Does rate exceed T for 2–3 consecutive windows?\n• NO ➔ Continue monitoring\n• YES ➔ Declare Microburst")
    ]
    for s_title, s_desc in c1_steps:
        p_st = tf_c1.add_paragraph()
        p_st.text = f"▶ {s_title}"
        p_st.font.name = FONT_FAMILY
        p_st.font.size = Pt(10.5)
        p_st.font.bold = True
        p_st.font.color.rgb = COLOR_WHITE
        p_st.space_after = Pt(1)

        p_sd = tf_c1.add_paragraph()
        p_sd.text = f"   {s_desc}"
        p_sd.font.name = FONT_FAMILY
        p_sd.font.size = Pt(9.5)
        p_sd.font.color.rgb = COLOR_TEXT_MUTED
        p_sd.space_after = Pt(8)

    # Column 2: Attribution & Policy Enforcement (Middle)
    col2_card = create_card(slide5, Inches(4.8), Inches(2.4), Inches(3.7), Inches(4.55))
    tf_c2 = col2_card.text_frame
    tf_c2.word_wrap = True
    tf_c2.margin_left = Inches(0.25)
    tf_c2.margin_top = Inches(0.2)
    tf_c2.margin_right = Inches(0.25)

    p_c2h = tf_c2.paragraphs[0]
    p_c2h.text = "2. ATTRIBUTION & MITIGATION"
    p_c2h.font.name = FONT_FAMILY
    p_c2h.font.size = Pt(11)
    p_c2h.font.bold = True
    p_c2h.font.color.rgb = COLOR_RED_ACCENT
    p_c2h.space_after = Pt(10)

    c2_steps = [
        ("Source Contribution Ranking", "Computes per-IP byte contributions. Isolates top offender flow."),
        ("Severity Ratio Evaluation", "Evaluates peak/baseline ratio:\n• Moderate (ratio < 5×) ➔ 60 Mbps Cap\n• Severe (ratio ≥ 5×) ➔ 35 Mbps Cap"),
        ("HTB Rate Shaping Execution", "Adds Linux HTB class 1:10 and Flower filter. (Dry-run by default; real kernel shaping requires explicit authorization)."),
        ("Immutable Audit Recording", "Logs event in SQLite EventStore (timestamp, flow, severity, action).")
    ]
    for s_title, s_desc in c2_steps:
        p_st = tf_c2.add_paragraph()
        p_st.text = f"▶ {s_title}"
        p_st.font.name = FONT_FAMILY
        p_st.font.size = Pt(10.5)
        p_st.font.bold = True
        p_st.font.color.rgb = COLOR_WHITE
        p_st.space_after = Pt(1)

        p_sd = tf_c2.add_paragraph()
        p_sd.text = f"   {s_desc}"
        p_sd.font.name = FONT_FAMILY
        p_sd.font.size = Pt(9.5)
        p_sd.font.color.rgb = COLOR_TEXT_MUTED
        p_sd.space_after = Pt(8)

    # Column 3: Recovery & Re-arming Lifecycle (Right)
    col3_card = create_card(slide5, Inches(8.9), Inches(2.4), Inches(3.6), Inches(4.55))
    tf_c3 = col3_card.text_frame
    tf_c3.word_wrap = True
    tf_c3.margin_left = Inches(0.25)
    tf_c3.margin_top = Inches(0.2)
    tf_c3.margin_right = Inches(0.25)

    p_c3h = tf_c3.paragraphs[0]
    p_c3h.text = "3. RECOVERY & WATCHDOG"
    p_c3h.font.name = FONT_FAMILY
    p_c3h.font.size = Pt(11)
    p_c3h.font.bold = True
    p_c3h.font.color.rgb = COLOR_GREEN_ACCENT
    p_c3h.space_after = Pt(10)

    c3_steps = [
        ("Recovery Condition Check", "Monitors for 3 consecutive quiet windows (demo) or 10 quiet windows (prod)."),
        ("Watchdog Duration Ceiling", "Wall-clock timer expires if traffic abruptly stops idle (250 ms demo / 8,000 ms prod)."),
        ("De-escalation & Rule Removal", "Tears down HTB filter & class 1:10. Restores parent class 1:1."),
        ("Audit & Re-arm Engine", "Records mitigation_removed or mitigation_expired. Re-arms detection with cooldown.")
    ]
    for s_title, s_desc in c3_steps:
        p_st = tf_c3.add_paragraph()
        p_st.text = f"▶ {s_title}"
        p_st.font.name = FONT_FAMILY
        p_st.font.size = Pt(10.5)
        p_st.font.bold = True
        p_st.font.color.rgb = COLOR_WHITE
        p_st.space_after = Pt(1)

        p_sd = tf_c3.add_paragraph()
        p_sd.text = f"   {s_desc}"
        p_sd.font.name = FONT_FAMILY
        p_sd.font.size = Pt(9.5)
        p_sd.font.color.rgb = COLOR_TEXT_MUTED
        p_sd.space_after = Pt(8)

    # =========================================================================
    # SLIDE 6: TECHNOLOGY STACK AND REFERENCES
    # =========================================================================
    slide6 = prs.slides.add_slide(blank_layout)
    set_slide_background(slide6, prs)
    add_header(slide6, "Technology Stack & Technical References")

    # Left Column: Technology Stack Card
    tech_card = create_card(slide6, Inches(0.8), Inches(1.65), Inches(5.7), Inches(5.35))
    tf_tech = tech_card.text_frame
    tf_tech.word_wrap = True
    tf_tech.margin_left = Inches(0.35)
    tf_tech.margin_top = Inches(0.25)
    tf_tech.margin_right = Inches(0.35)
    tf_tech.margin_bottom = Inches(0.25)

    p_th = tf_tech.paragraphs[0]
    p_th.text = "CORE TECHNOLOGY STACK"
    p_th.font.name = FONT_FAMILY
    p_th.font.size = Pt(12)
    p_th.font.bold = True
    p_th.font.color.rgb = COLOR_CYAN_ACCENT
    p_th.space_after = Pt(12)

    tech_items = [
        ("Python 3.12 (Core Engine)", "Detection state machine, sliding EWMA window processing, attribution ranking, policy arbitration, and unit regression test suites."),
        ("Linux Traffic Control (tc) & HTB", "Hierarchical Token Bucket (sch_htb) rate shaping, flower source-IP classification, and token bucket token pacing."),
        ("Packet Capture Components", "High-frequency packet observation, Scapy capture pipeline, and raw socket telemetry."),
        ("SQLite 3 (EventStore)", "Persistent, thread-safe audit logging for lifecycle events (burst_detected, mitigation_applied, expired, removed)."),
        ("React 18 + Vite + TypeScript", "Real-time network simulation dashboard, interactive topology viewer, and telemetry graph rendering."),
        ("Windows 11 + WSL 2 (Ubuntu 24.04)", "Authoritative development clone (Windows) and isolated kernel namespace validation environment (Linux).")
    ]
    for tech_name, tech_desc in tech_items:
        p_t = tf_tech.add_paragraph()
        p_t.text = f"■  {tech_name}"
        p_t.font.name = FONT_FAMILY
        p_t.font.size = Pt(11)
        p_t.font.bold = True
        p_t.font.color.rgb = COLOR_WHITE
        p_t.space_after = Pt(1)

        p_td = tf_tech.add_paragraph()
        p_td.text = f"    {tech_desc}"
        p_td.font.name = FONT_FAMILY
        p_td.font.size = Pt(9.5)
        p_td.font.color.rgb = COLOR_TEXT_MUTED
        p_td.space_after = Pt(7)

    # Right Column: Technical References Card
    ref_card = create_card(slide6, Inches(6.8), Inches(1.65), Inches(5.7), Inches(5.35))
    tf_ref = ref_card.text_frame
    tf_ref.word_wrap = True
    tf_ref.margin_left = Inches(0.35)
    tf_ref.margin_top = Inches(0.25)
    tf_ref.margin_right = Inches(0.35)
    tf_ref.margin_bottom = Inches(0.25)

    p_rh = tf_ref.paragraphs[0]
    p_rh.text = "TECHNICAL DOCUMENTATION & REFERENCES"
    p_rh.font.name = FONT_FAMILY
    p_rh.font.size = Pt(12)
    p_rh.font.bold = True
    p_rh.font.color.rgb = COLOR_BLUE_ACCENT
    p_rh.space_after = Pt(12)

    refs = [
        ("Linux tc Manual (man 8 tc)", "Traffic Control architecture, queuing disciplines, and packet scheduling.", "https://man7.org/linux/man-pages/man8/tc.8.html"),
        ("Linux HTB Manual (man 8 tc-htb)", "Hierarchical Token Bucket algorithm, rate and ceil token enforcement.", "https://man7.org/linux/man-pages/man8/tc-htb.8.html"),
        ("Python Standard Library Documentation", "Thread-safe primitives, time.monotonic(), and socket networking.", "https://docs.python.org/3/"),
        ("SQLite Documentation", "ACID persistence, write-ahead logging, and query audit architecture.", "https://www.sqlite.org/docs.html"),
        ("Scapy Network Telemetry Documentation", "Packet crafting, frame dissection, and pcap observation engine.", "https://scapy.net/"),
        ("React Documentation", "Declarative component lifecycle and real-time state visualization.", "https://react.dev/"),
        ("Vite Build Tool Documentation", "Modern frontend tooling and optimized production bundling.", "https://vite.dev/")
    ]
    for idx, (r_name, r_desc, r_url) in enumerate(refs, start=1):
        p_r = tf_ref.add_paragraph()
        p_r.text = f"[{idx}]  {r_name}"
        p_r.font.name = FONT_FAMILY
        p_r.font.size = Pt(10.5)
        p_r.font.bold = True
        p_r.font.color.rgb = COLOR_CYAN_ACCENT
        p_r.space_after = Pt(1)

        p_rd = tf_ref.add_paragraph()
        p_rd.text = f"      {r_desc}\n      URL: {r_url}"
        p_rd.font.name = FONT_FAMILY
        p_rd.font.size = Pt(9)
        p_rd.font.color.rgb = COLOR_TEXT_MUTED
        p_rd.space_after = Pt(6)

    # =========================================================================
    # SLIDE 7: THANK YOU & CLOSING
    # =========================================================================
    slide7 = prs.slides.add_slide(blank_layout)
    set_slide_background(slide7, prs)

    # Background Image (Right / Centered)
    if os.path.exists(CLOSING_IMG_PATH):
        img_c = slide7.shapes.add_picture(CLOSING_IMG_PATH, Inches(4.5), Inches(0), Inches(8.833), Inches(7.5))
        # Left Vignette Overlay to blend text panel
        vig = slide7.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(4.0), Inches(0), Inches(1.8), Inches(7.5))
        vig.fill.solid()
        vig.fill.fore_color.rgb = COLOR_BG_DARK
        vig.line.fill.background()

    # Left Overlay Panel
    left_over = slide7.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0), Inches(0), Inches(4.5), Inches(7.5))
    left_over.fill.solid()
    left_over.fill.fore_color.rgb = COLOR_BG_DARK
    left_over.line.fill.background()

    # Thank You Box
    ty_box = slide7.shapes.add_textbox(Inches(0.8), Inches(1.8), Inches(5.0), Inches(4.0))
    tf_ty = ty_box.text_frame
    tf_ty.word_wrap = True
    tf_ty.margin_left = tf_ty.margin_top = tf_ty.margin_right = tf_ty.margin_bottom = 0

    p_ty_tag = tf_ty.paragraphs[0]
    p_ty_tag.text = "COURSE BASED PROJECT  |  COMPUTER NETWORKS"
    p_ty_tag.font.name = FONT_FAMILY
    p_ty_tag.font.size = Pt(10)
    p_ty_tag.font.bold = True
    p_ty_tag.font.color.rgb = COLOR_CYAN_ACCENT
    p_ty_tag.space_after = Pt(10)

    p_ty = tf_ty.add_paragraph()
    p_ty.text = "THANK YOU"
    p_ty.font.name = FONT_FAMILY
    p_ty.font.size = Pt(44)
    p_ty.font.bold = True
    p_ty.font.color.rgb = COLOR_WHITE
    p_ty.space_after = Pt(12)

    p_tysub = tf_ty.add_paragraph()
    p_tysub.text = "MicroburstHunter"
    p_tysub.font.name = FONT_FAMILY
    p_tysub.font.size = Pt(20)
    p_tysub.font.bold = True
    p_tysub.font.color.rgb = COLOR_CYAN_ACCENT
    p_tysub.space_after = Pt(10)

    p_tysup = tf_ty.add_paragraph()
    p_tysup.text = "Real-Time Detection and Adaptive Mitigation of Microbursts in Data Center Networks"
    p_tysup.font.name = FONT_FAMILY
    p_tysup.font.size = Pt(13)
    p_tysup.font.color.rgb = COLOR_TEXT_DIM
    p_tysup.space_after = Pt(28)

    p_disc = tf_ty.add_paragraph()
    p_disc.text = "Questions & Discussion"
    p_disc.font.name = FONT_FAMILY
    p_disc.font.size = Pt(18)
    p_disc.font.bold = True
    p_disc.font.color.rgb = COLOR_BLUE_ACCENT

    # Save presentation
    prs.save(OUTPUT_PPTX)
    print(f"Presentation successfully created at: {OUTPUT_PPTX}")

if __name__ == "__main__":
    build_presentation()
