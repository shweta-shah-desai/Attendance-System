# Generates every image asset from the full-resolution source logo.
#   powershell -ExecutionPolicy Bypass -File scripts/make-images.ps1
#
# About the source: GharSaathi_Logo.png (2816x1536) is a SCREENSHOT of a
# transparent-background logo taken inside an image editor, so the editor's
# grey/white transparency checkerboard is baked into the pixels and the file
# has no real alpha channel. This script keys that neutral background out,
# trims the empty margin, and derives every size the app needs.
#
# Outputs (assets/images):
#   logo.png            trimmed wordmark, full colour  - for white surfaces
#   logo-light.png      trimmed wordmark, navy->white  - for the teal header
#   icon.png            1024 square, teal + light mark - iOS / store icon
#   adaptive-icon.png   1024 square, transparent       - Android foreground
#   favicon.png         196 square, teal + light mark  - web
#   logo-preview.png    contact sheet for eyeballing the result

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$csharp = @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;

public static class ImgTool
{
    // Neutral (r==g==b-ish) and bright pixels are the baked-in checkerboard.
    // Their RGB is set to white rather than black so that the bicubic resize
    // below cannot smear a dark halo along the glyph edges.
    public static Bitmap LoadKeyed(string path, int neutralSpread, int minBright)
    {
        Bitmap bmp;
        using (Image img = Image.FromFile(path))
        {
            bmp = new Bitmap(img.Width, img.Height, PixelFormat.Format32bppArgb);
            using (Graphics g = Graphics.FromImage(bmp))
            {
                g.CompositingMode = CompositingMode.SourceCopy;
                g.DrawImage(img, 0, 0, img.Width, img.Height);
            }
        }

        Rectangle rect = new Rectangle(0, 0, bmp.Width, bmp.Height);
        BitmapData data = bmp.LockBits(rect, ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
        int len = data.Stride * bmp.Height;
        byte[] buf = new byte[len];
        Marshal.Copy(data.Scan0, buf, 0, len);

        for (int i = 0; i < len; i += 4)
        {
            int b = buf[i], g2 = buf[i + 1], r = buf[i + 2];
            int mx = Math.Max(r, Math.Max(g2, b));
            int mn = Math.Min(r, Math.Min(g2, b));
            if (mx - mn <= neutralSpread && mn >= minBright)
            {
                buf[i] = 255; buf[i + 1] = 255; buf[i + 2] = 255; buf[i + 3] = 0;
            }
        }

        Marshal.Copy(buf, 0, data.Scan0, len);
        bmp.UnlockBits(data);
        return bmp;
    }

    public static Rectangle TrimBounds(Bitmap bmp, int alphaThreshold)
    {
        Rectangle rect = new Rectangle(0, 0, bmp.Width, bmp.Height);
        BitmapData data = bmp.LockBits(rect, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        int len = data.Stride * bmp.Height;
        byte[] buf = new byte[len];
        Marshal.Copy(data.Scan0, buf, 0, len);
        bmp.UnlockBits(data);

        int minX = bmp.Width, minY = bmp.Height, maxX = -1, maxY = -1;
        for (int y = 0; y < bmp.Height; y++)
        {
            int row = y * data.Stride;
            for (int x = 0; x < bmp.Width; x++)
            {
                if (buf[row + x * 4 + 3] > alphaThreshold)
                {
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                }
            }
        }
        if (maxX < 0) throw new Exception("Image is fully transparent after keying");
        return new Rectangle(minX, minY, maxX - minX + 1, maxY - minY + 1);
    }

    public static Bitmap CropScale(Bitmap src, Rectangle from, int width)
    {
        int height = (int)Math.Round((double)width * from.Height / from.Width);
        Bitmap outBmp = new Bitmap(width, height, PixelFormat.Format32bppArgb);
        using (Graphics g = Graphics.FromImage(outBmp))
        using (ImageAttributes ia = new ImageAttributes())
        {
            ia.SetWrapMode(WrapMode.TileFlipXY); // stops edge ghosting
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.CompositingQuality = CompositingQuality.HighQuality;
            g.CompositingMode = CompositingMode.SourceCopy;
            g.DrawImage(src, new Rectangle(0, 0, width, height), from.X, from.Y,
                        from.Width, from.Height, GraphicsUnit.Pixel, ia);
        }
        return outBmp;
    }

    // Every visible pixel is either navy or orange, so blue-dominant pixels
    // (anti-aliased edges included) go white and the orange is left alone.
    public static Bitmap Lighten(Bitmap src)
    {
        Bitmap copy = new Bitmap(src);
        Rectangle rect = new Rectangle(0, 0, copy.Width, copy.Height);
        BitmapData data = copy.LockBits(rect, ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
        int len = data.Stride * copy.Height;
        byte[] buf = new byte[len];
        Marshal.Copy(data.Scan0, buf, 0, len);

        for (int i = 0; i < len; i += 4)
        {
            if (buf[i + 3] == 0) continue;
            if (buf[i] >= buf[i + 2]) { buf[i] = 255; buf[i + 1] = 255; buf[i + 2] = 255; }
        }

        Marshal.Copy(buf, 0, data.Scan0, len);
        copy.UnlockBits(data);
        return copy;
    }

    public static void Square(Bitmap mark, string dest, int size, string bg, double scale)
    {
        using (Bitmap bmp = new Bitmap(size, size, PixelFormat.Format32bppArgb))
        {
            using (Graphics g = Graphics.FromImage(bmp))
            {
                g.Clear(string.IsNullOrEmpty(bg) ? Color.Transparent : ColorTranslator.FromHtml(bg));
                g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                g.CompositingQuality = CompositingQuality.HighQuality;
                g.CompositingMode = CompositingMode.SourceOver;
                int w = (int)(size * scale);
                int h = (int)Math.Round((double)w * mark.Height / mark.Width);
                g.DrawImage(mark, (size - w) / 2, (size - h) / 2, w, h);
            }
            bmp.Save(dest, ImageFormat.Png);
        }
    }

    // A 6.2:1 wordmark shrinks to an illegible strip on a square icon, so the
    // icon stacks the existing artwork onto two lines, split at the natural
    // gap between "Ghar" and "Saathi+". Both halves share one scale factor so
    // the letterforms stay the same size.
    public static void SquareStacked(Bitmap mark, string dest, int size, string bg,
                                     double splitFraction, double inset, double gapFraction)
    {
        int splitX = (int)Math.Round(mark.Width * splitFraction);
        Rectangle topSrc = new Rectangle(0, 0, splitX, mark.Height);
        Rectangle botSrc = new Rectangle(splitX, 0, mark.Width - splitX, mark.Height);

        int contentW = (int)(size * inset);
        int wider = Math.Max(topSrc.Width, botSrc.Width);
        double scale = (double)contentW / wider;

        int topW = (int)Math.Round(topSrc.Width * scale);
        int botW = (int)Math.Round(botSrc.Width * scale);
        int lineH = (int)Math.Round(mark.Height * scale);
        int gap = (int)Math.Round(lineH * gapFraction);
        int totalH = lineH * 2 + gap;
        int y0 = (size - totalH) / 2;

        using (Bitmap bmp = new Bitmap(size, size, PixelFormat.Format32bppArgb))
        {
            using (Graphics g = Graphics.FromImage(bmp))
            using (ImageAttributes ia = new ImageAttributes())
            {
                ia.SetWrapMode(WrapMode.TileFlipXY);
                g.Clear(string.IsNullOrEmpty(bg) ? Color.Transparent : ColorTranslator.FromHtml(bg));
                g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                g.CompositingQuality = CompositingQuality.HighQuality;
                g.CompositingMode = CompositingMode.SourceOver;

                g.DrawImage(mark, new Rectangle((size - topW) / 2, y0, topW, lineH),
                            topSrc.X, topSrc.Y, topSrc.Width, topSrc.Height, GraphicsUnit.Pixel, ia);
                g.DrawImage(mark, new Rectangle((size - botW) / 2, y0 + lineH + gap, botW, lineH),
                            botSrc.X, botSrc.Y, botSrc.Width, botSrc.Height, GraphicsUnit.Pixel, ia);
            }
            bmp.Save(dest, ImageFormat.Png);
        }
    }

    // Contact sheet: the colour mark on white, the light mark on teal.
    public static void Preview(Bitmap dark, Bitmap light, string dest, string teal)
    {
        int w = 700, band = 150;
        using (Bitmap bmp = new Bitmap(w, band * 2, PixelFormat.Format32bppArgb))
        using (Graphics g = Graphics.FromImage(bmp))
        {
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.CompositingQuality = CompositingQuality.HighQuality;
            g.FillRectangle(Brushes.White, 0, 0, w, band);
            using (Brush tb = new SolidBrush(ColorTranslator.FromHtml(teal)))
                g.FillRectangle(tb, 0, band, w, band);

            int dw = 420, dh = (int)Math.Round((double)dw * dark.Height / dark.Width);
            g.DrawImage(dark, (w - dw) / 2, (band - dh) / 2, dw, dh);
            g.DrawImage(light, (w - dw) / 2, band + (band - dh) / 2, dw, dh);
            bmp.Save(dest, ImageFormat.Png);
        }
    }
}
'@

Add-Type -TypeDefinition $csharp -ReferencedAssemblies System.Drawing

$root   = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root 'GharSaathi_Logo.png'
$outDir = Join-Path $root 'assets\images'
$TEAL   = '#1F4E79'

if (-not (Test-Path $source)) { throw "Source logo not found: $source" }

function Save-Png {
    param($bmp, [string]$Name)
    $path = Join-Path $outDir $Name
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    Write-Output ("{0,-20} {1}x{2}  {3} KB" -f $Name, $bmp.Width, $bmp.Height,
        [int]((Get-Item $path).Length / 1KB))
}

$keyed = [ImgTool]::LoadKeyed($source, 26, 186)
Write-Output ("source               {0}x{1}" -f $keyed.Width, $keyed.Height)

$bounds = [ImgTool]::TrimBounds($keyed, 16)
Write-Output ("visible content      {0},{1}  {2}x{3}  (ratio {4:N2}:1)" -f `
    $bounds.X, $bounds.Y, $bounds.Width, $bounds.Height, ($bounds.Width / $bounds.Height))

$logo  = [ImgTool]::CropScale($keyed, $bounds, 600)
$light = [ImgTool]::Lighten($logo)

Save-Png $logo  'logo.png'
Save-Png $light 'logo-light.png'

# Icons are built from a higher-resolution crop so the stacked lines stay sharp
# at 1024 instead of being upscaled from the 600px in-app asset.
$hi      = [ImgTool]::CropScale($keyed, $bounds, 1600)
$hiLight = [ImgTool]::Lighten($hi)

# Fraction of the width where "Ghar" ends and "Saathi+" begins, measured from
# the alpha gaps in the trimmed mark.
$SPLIT = 0.4017

# iOS icons must be square and opaque - PNG alpha is rejected by App Store.
[ImgTool]::SquareStacked($hiLight, (Join-Path $outDir 'icon.png'), 1024, $TEAL, $SPLIT, 0.72, 0.22)
# Android masks roughly the outer third of the adaptive foreground away.
[ImgTool]::SquareStacked($hiLight, (Join-Path $outDir 'adaptive-icon.png'), 1024, '', $SPLIT, 0.52, 0.22)
[ImgTool]::SquareStacked($hiLight, (Join-Path $outDir 'favicon.png'), 196, $TEAL, $SPLIT, 0.78, 0.22)
[ImgTool]::Preview($logo, $light, (Join-Path $outDir 'logo-preview.png'), $TEAL)
$hi.Dispose(); $hiLight.Dispose()

foreach ($n in 'icon.png', 'adaptive-icon.png', 'favicon.png', 'logo-preview.png') {
    $f = Get-Item (Join-Path $outDir $n)
    Write-Output ("{0,-20} {1} KB" -f $n, [int]($f.Length / 1KB))
}

$keyed.Dispose(); $logo.Dispose(); $light.Dispose()
Write-Output 'done'
