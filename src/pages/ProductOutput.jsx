import { useEffect, useState } from "react";
import { FolderOpen, Save, RotateCcw } from "lucide-react";
import { api } from "../api.js";
import { Button, Field } from "../components.jsx";

export function ProductOutputPicker({
  value,
  onChange,
  notify,
  kind = "product",
  label,
  formId,
}) {
  const isNews = kind === "news", title = isNews ? "News" : "Product";
  const endpoint = `/${kind}-output`, eventName = `${kind}-output-default-changed`;
  const chooseFolder = window.studioDesktop?.[isNews ? "chooseNewsOutput" : "chooseProductOutput"];
  const openFolder = window.studioDesktop?.[isNews ? "openNewsOutput" : "openProductOutput"];
  const [settings, setSettings] = useState(null),
    [manual, setManual] = useState(Boolean(value)),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const refresh = () =>
      api(`${endpoint}/settings`)
        .then(setSettings)
        .catch((e) => notify(e.message, "error"));
    refresh();
    window.addEventListener(eventName, refresh);
    return () =>
      window.removeEventListener(eventName, refresh);
  }, [notify, kind]);
  useEffect(() => {
    if (value) setManual(true);
  }, [value]);
  const choose = async () => {
    if (!chooseFolder) {
      setManual(true);
      notify(
        "Bạn đang mở bằng trình duyệt. Nhập đường dẫn đầy đủ, hoặc mở app Desktop để chọn folder bằng hộp thoại Windows.",
      );
      return;
    }
    setBusy(true);
    try {
      const r = await chooseFolder();
      if (!r.cancelled && r.directory) {
        onChange(r.directory);
        setManual(true);
      }
    } catch (e) {
      notify(e.message, "error");
    } finally {
      setBusy(false);
    }
  };
  const saveDefault = async (directory) => {
    setBusy(true);
    try {
      const result = await api(
        `${endpoint}/settings`,
        { directory },
        "PATCH",
      );
      setSettings(result);
      onChange("");
      setManual(false);
      window.dispatchEvent(new Event(eventName));
      notify(
        directory
          ? `Đã lưu thư mục mặc định cho ${title}.`
          : `Đã dùng thư mục ${title} mặc định của app.`,
      );
    } catch (e) {
      notify(e.message, "error");
    } finally {
      setBusy(false);
    }
  };
  const destination = manual ? value : settings?.defaultDirectory;
  const open = async () => {
    try {
      if (openFolder)
        await openFolder(destination || "");
      else {
        const result = await api(`${endpoint}/resolve`, {
          directory: destination || "",
        });
        await navigator.clipboard.writeText(result.directory);
        notify(`Đã sao chép đường dẫn thư mục ${title}.`);
      }
    } catch (e) {
      notify(e.message, "error");
    }
  };
  return (
    <section className="product-output-picker">
      <Field label={label || `Nơi lưu video ${title}`}>
        <select
          value={manual ? "custom" : "default"}
          onChange={(e) => {
            setManual(e.target.value === "custom");
            onChange(
              e.target.value === "custom"
                ? value || settings?.defaultDirectory || ""
                : "",
            );
          }}
        >
          <option value="default">Dùng thư mục mặc định {title}</option>
          <option value="custom">Chọn thư mục riêng cho đợt này</option>
        </select>
      </Field>
      {manual && (
        <Field label={`Đường dẫn thư mục ${title}`}>
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={`Ví dụ: D:\\Video ${title}`}
            required
            form={formId}
            maxLength={2048}
          />
        </Field>
      )}
      <p className="small muted">Video hoàn thành được lưu tại:</p>
      <code className="product-output-path">
        {destination || "Chưa chọn thư mục"}
      </code>
      <div className="product-actions">
        <Button type="button" busy={busy} onClick={choose}>
          <FolderOpen size={14} />
          Chọn thư mục…
        </Button>
        <Button type="button" disabled={!destination} onClick={open}>
          Mở thư mục Output
        </Button>
        {manual && (
          <Button
            type="button"
            busy={busy}
            disabled={!value.trim()}
            onClick={() => saveDefault(value)}
          >
            <Save size={14} />
            Đặt làm mặc định {title}
          </Button>
        )}
        {settings?.customDefaultDirectory && (
          <Button type="button" busy={busy} onClick={() => saveDefault("")}>
            <RotateCcw size={14} />
            Về mặc định của app
          </Button>
        )}
      </div>
      <p className="small muted">
        Chỉ đổi nơi lưu video {title} mới. Mỗi video là một MP4 riêng; đợt đã
        tạo giữ nguyên thư mục đã chọn.
      </p>
      {isNews && settings?.productDirectory && <p className="small muted">Product lưu riêng tại: {settings.productDirectory}. Nếu chọn cùng thư mục, file của hai luồng sẽ nằm chung chỗ.</p>}
      {settings?.newsDirectory && (
        <details className="product-output-separation">
          <summary>Product và News lưu ở đâu?</summary>
          <p className="small">
            <strong>Product hoàn chỉnh:</strong> {settings.defaultDirectory}
          </p>
          <p className="small">
            <strong>Clip Product:</strong> {settings.clipsDirectory}
          </p>
          <p className="small">
            <strong>News:</strong> {settings.newsDirectory} (MP4 trực tiếp trong
            thư mục này)
          </p>
          <p className="small muted">
            Đổi thư mục Product không đổi nơi xuất News. Nếu tự chọn cùng thư
            mục News thì các file sẽ nằm chung chỗ; chọn folder khác để quản lý
            riêng.
          </p>
        </details>
      )}
    </section>
  );
}

export function NewsOutputPicker(props) { return <ProductOutputPicker {...props} kind="news" />; }

export function ProductOutputLocation({ directory, notify }) {
  if (!directory) return null;
  const open = async () => {
    try {
      if (window.studioDesktop?.openProductOutput)
        await window.studioDesktop.openProductOutput(directory);
      else {
        await navigator.clipboard.writeText(directory);
        notify("Đã sao chép đường dẫn Output.");
      }
    } catch (e) {
      notify(e.message, "error");
    }
  };
  return (
    <div className="product-output-location">
      <small>Output của đợt này</small>
      <code className="product-output-path">{directory}</code>
      <Button type="button" onClick={open}>
        <FolderOpen size={14} />
        Mở Output của đợt
      </Button>
    </div>
  );
}
