"""Treehouse_Claude_Package/images 에서 사이트용 그림 조각을 만든다.
사용: python3 tools/extract_assets.py <images 폴더 경로>
원본 배경은 그대로 복사하고, 시트에서는 필요한 조각만 투명 PNG로 잘라 낸다."""
import sys, os, shutil, numpy as np
from PIL import Image

SRC = sys.argv[1]
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'img')
os.makedirs(os.path.join(OUT, 'tabs'), exist_ok=True)

def tight(im, box):
    """시트의 한 칸(box)에서 불투명 부분만 잘라 낸다."""
    c = im.crop(box)
    a = np.asarray(c)[:, :, 3]
    ys, xs = np.where(a > 20)
    return c.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))

# 1) 배경 원본
shutil.copyfile(os.path.join(SRC, '01_entrance.png'), os.path.join(OUT, 'porch.png'))
shutil.copyfile(os.path.join(SRC, '02_room.png'), os.path.join(OUT, 'room.png'))

# 2) 문틈으로 보이는 실내: doorway_reveal(1585px)을 현관 크기(1586px)에 맞추고 문 부분만 잘라 둔다.
rev = Image.open(os.path.join(SRC, 'motion-references', 'doorway_reveal.png')).convert('RGB').resize((1586, 992), Image.LANCZOS)
rev.crop((360, 220, 690, 715)).save(os.path.join(OUT, 'doorway.png'), optimize=True)  # 원본 기준 왼쪽 위 (360,220)

# 3) 현판 뒷면용 빈 판자, 소품 조각
ep = Image.open(os.path.join(SRC, 'motion-references', 'entry_parts.png')).convert('RGBA')
tight(ep, (60, 780, 660, 1060)).save(os.path.join(OUT, 'plank.png'), optimize=True)
sp = Image.open(os.path.join(SRC, 'motion-references', 'small_props.png')).convert('RGBA')
tight(sp, (900, 50, 1400, 460)).resize((60, 96), Image.LANCZOS).save(os.path.join(OUT, 'flame.png'), optimize=True)
bird = tight(sp, (900, 560, 1400, 960))
bird.resize((bird.width // 4, bird.height // 4), Image.LANCZOS).save(os.path.join(OUT, 'bird.png'), optimize=True)
rp = Image.open(os.path.join(SRC, 'motion-references', 'record_parts.png')).convert('RGBA')
tight(rp, (40, 100, 620, 680)).resize((256, 256), Image.LANCZOS).save(os.path.join(OUT, 'record.png'), optimize=True)

# 4) 꺼진 초: 불꽃 자리를 양옆 배경으로 메운 작은 조각 (원본 기준 왼쪽 위 (636,318), 26x26)
room = np.asarray(Image.open(os.path.join(SRC, '02_room.png')).convert('RGB')).astype(float)
x0, y0, w, h = 636, 318, 26, 26
patch = room[y0:y0 + h, x0:x0 + w].copy()
for yy in range(h - 4):  # 아래 4줄은 초 몸통 윗부분이라 그대로 둔다
    left, right = patch[yy, 2], patch[yy, w - 3]
    for xx in range(4, w - 4):
        t = (xx - 2) / (w - 5)
        patch[yy, xx] = left * (1 - t) + right * t
Image.fromarray(patch.clip(0, 255).astype(np.uint8)).save(os.path.join(OUT, 'candle-off.png'))

# 5) 카테고리 배경: 화질 차이가 거의 없는 JPEG로 바꿔 처음 열 때 빨리 뜨게 한다.
for f in os.listdir(os.path.join(SRC, 'tabs')):
    if f.endswith('.png'):
        Image.open(os.path.join(SRC, 'tabs', f)).convert('RGB').save(os.path.join(OUT, 'tabs', f[:-4] + '.jpg'), quality=88, optimize=True)
print('done')

# 6) 소품을 움직일 때 아래에 깔 '빈 배경' 조각: 소품 자리를 주변 색으로 번지게 메운다.
from PIL import ImageDraw, ImageFilter
PLANT = [(462,384),(484,380),(500,388),(520,394),(540,398),(548,412),(556,428),(562,448),(566,466),(566,486),(560,496),(562,512),(556,528),(540,528),(530,512),(524,498),(500,500),(470,500),(460,488),(452,468),(440,462),(436,448),(438,430),(442,414),(450,400)]
CUP = [(1052,470),(1056,465),(1084,465),(1088,470),(1087,476),(1094,475),(1100,481),(1100,494),(1094,501),(1087,502),(1084,509),(1055,509),(1051,503),(1051,478)]
def clean_plate(poly, box, name):
    x0, y0, x1, y1 = box
    crop = room[y0:y1, x0:x1].copy()
    m = Image.new('L', (x1 - x0, y1 - y0), 0)
    ImageDraw.Draw(m).polygon([(x - x0, y - y0) for x, y in poly], fill=255)
    m = np.asarray(m.filter(ImageFilter.MaxFilter(5))) > 0
    img = crop.copy()
    img[m] = crop[~m].mean(0)
    for _ in range(2500):  # 주변 색이 안쪽으로 번지게
        avg = (np.roll(img, 1, 0) + np.roll(img, -1, 0) + np.roll(img, 1, 1) + np.roll(img, -1, 1)) / 4
        img[m] = avg[m]
    Image.fromarray(img.clip(0, 255).astype(np.uint8)).save(os.path.join(OUT, name))
clean_plate(PLANT, (428, 372, 574, 536), 'plant-clean.png')
clean_plate(CUP, (1042, 458, 1110, 518), 'cup-clean.png')
print('plates done')

# 7) 직접 그린 컵·화분 레이어가 있으면 그것을 쓴다 (Plot_Twist_Cup_Plant_PNG 폴더, 두 번째 인자).
#    소품 레이어는 필요한 영역만 잘라 두고, '지운 배경'은 소품 자리(+4px)만 원본 위에 옮겨 담는다.
if len(sys.argv) > 2:
    PD = sys.argv[2]
    roomI = np.asarray(Image.open(os.path.join(SRC, '02_room.png')).convert('RGB'))
    for name, pad in (('cup', 4), ('plant', 4)):
        spr = Image.open(os.path.join(PD, f'{name}-sprite.png')).convert('RGBA')
        al = np.asarray(spr)[:, :, 3]
        ys, xs = np.where(al > 0)
        box = (xs.min() - pad, ys.min() - pad, xs.max() + 1 + pad, ys.max() + 1 + pad)
        spr.crop(box).save(os.path.join(OUT, f'{name}-sprite.png'), optimize=True)
        without = np.asarray(Image.open(os.path.join(PD, f'room-without-{name}.png')).convert('RGB'))
        # only a thin, soft ring around the prop: the wall shadow the prop casts stays as it is
        area = Image.fromarray(al).point(lambda v: 255 if v > 0 else 0).filter(ImageFilter.MaxFilter(7)).filter(ImageFilter.GaussianBlur(2))
        k = (np.asarray(area).astype(float) / 255)[:, :, None]
        k[al > 0] = 1
        plate = (without * k + roomI * (1 - k)).round().clip(0, 255).astype(np.uint8)
        Image.fromarray(plate).crop(box).save(os.path.join(OUT, f'{name}-clean.png'), optimize=True)
        print(name, 'box', box)
