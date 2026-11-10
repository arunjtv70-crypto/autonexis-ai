import React, { useState, useEffect, useRef } from "react";
import { Modal } from "./Modal";
import { Button } from "./Button";
import { useChats } from "../state/chats";
import type { FirestoreProject } from "../db";
import {
  isPdfFile,
  isTextFile,
  readTextFile,
  extractPdfText,
  formatFileSize,
} from "../utils/fileHelpers";
import {
  IconFolder,
  IconPlus,
  IconTrash,
  IconFileText,
  IconCheck,
} from "./Icons";
import "./SettingsModal.css";

interface ProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingProject: FirestoreProject | null;
}

export const ProjectModal: React.FC<ProjectModalProps> = ({
  isOpen,
  onClose,
  editingProject,
}) => {
  const {
    chats,
    createOrUpdateProject,
    loadFilesForProject,
    projectFilesMap,
    addFileToProject,
    removeFileFromProject,
    deleteProject,
    createNewChat,
    selectChat,
  } = useChats();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [activeProj, setActiveProj] = useState<FirestoreProject | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileNote, setFileNote] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      setActiveProj(editingProject);
      setName(editingProject?.name || "");
      setDescription(editingProject?.description || "");
      setInstructions(editingProject?.instructions || "");
      setFileError(null);
      setFileNote(null);
      setConfirmDelete(false);
      if (editingProject) {
        loadFilesForProject(editingProject.id);
      }
    }
  }, [isOpen, editingProject, loadFilesForProject]);

  const files = activeProj ? projectFilesMap[activeProj.id] || [] : [];
  const projectChats = activeProj
    ? chats.filter((c) => c.projectId === activeProj.id && !c.archived)
    : [];

  const handleSaveProject = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!name.trim() || isSaving) return;
    setIsSaving(true);
    try {
      const saved = await createOrUpdateProject({
        id: activeProj?.id,
        name: name.trim(),
        description: description.trim(),
        instructions: instructions.trim().slice(0, 3000),
      });
      if (saved) {
        setActiveProj(saved);
        setFileNote("Project saved.");
        setTimeout(() => setFileNote(null), 2200);
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleProjectFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    e.target.value = "";

    let targetProj = activeProj;
    if (!targetProj) {
      if (!name.trim()) {
        setFileError("Please enter a project name first before uploading files.");
        return;
      }
      targetProj = await createOrUpdateProject({
        name: name.trim(),
        description: description.trim(),
        instructions: instructions.trim().slice(0, 3000),
      });
      if (targetProj) setActiveProj(targetProj);
    }
    if (!targetProj) return;

    if (files.length >= 5) {
      setFileError("Each project can hold up to 5 reference files.");
      return;
    }

    setIsUploading(true);
    setFileError(null);
    setFileNote(null);

    try {
      const f = fileList[0];
      let extractedText = "";

      if (isPdfFile(f)) {
        const res = await extractPdfText(f, 20, 50000);
        if (res.isScanned) {
          setFileError(
            `"${f.name}" looks like a scanned image PDF with no extractable text. Please convert pages to images and send them directly in chat.`
          );
          return;
        }
        extractedText = res.text;
        if (res.truncationNote) {
          setFileNote(res.truncationNote);
        }
      } else if (isTextFile(f)) {
        const raw = await readTextFile(f);
        if (raw.length > 50000) {
          extractedText = raw.slice(0, 50000);
          setFileNote(`Note: "${f.name}" was trimmed to 50,000 characters.`);
        } else {
          extractedText = raw;
        }
      } else {
        setFileError("Unsupported file type. Upload TXT, MD, CSV, JSON, code files, or text PDFs.");
        return;
      }

      if (!extractedText.trim()) {
        setFileError(`"${f.name}" appears to be empty.`);
        return;
      }

      await addFileToProject(targetProj.id, {
        name: f.name,
        size: f.size,
        type: f.type || "text/plain",
        content: extractedText,
      });
    } catch (err) {
      console.error("[AUTONEXIS PROJECT] File upload failed:", err);
      setFileError("Could not read this file. Please try another file.");
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeleteProject = async () => {
    if (!activeProj) return;
    await deleteProject(activeProj.id);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={activeProj ? `Project: ${activeProj.name}` : "New Project"}
      maxWidth="640px"
    >
      <div className="settings-tab-pane" style={{ gap: "1rem" }}>
        <div className="settings-row-col" style={{ paddingTop: 0 }}>
          <label className="settings-item-title">Project Name</label>
          <input
            type="text"
            className="settings-input-control"
            style={{ maxWidth: "none" }}
            placeholder="e.g. Shop Inventory App, Class Notes, Q4 Planning"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
          />
        </div>

        <div className="settings-row-col" style={{ paddingTop: 0 }}>
          <label className="settings-item-title">Short Description</label>
          <input
            type="text"
            className="settings-input-control"
            style={{ maxWidth: "none" }}
            placeholder="What is this project about?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={300}
          />
        </div>

        <div className="settings-row-col" style={{ paddingTop: 0 }}>
          <div className="settings-row-header-between">
            <label className="settings-item-title">Project Instructions</label>
            <span className="settings-char-counter">{instructions.length} / 3000</span>
          </div>
          <span className="settings-item-desc">
            Custom guidelines applied to chats inside this project (takes priority over general personalization).
          </span>
          <textarea
            className="settings-textarea-control"
            rows={4}
            maxLength={3000}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="e.g. Always cite figures from the uploaded files and answer in concise bullet points."
          />
        </div>

        <div className="settings-save-row" style={{ justifyContent: "space-between" }}>
          <div>
            {activeProj && !confirmDelete && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmDelete(true)}
                style={{ color: "var(--danger, #ef4444)", borderColor: "rgba(239,68,68,0.35)" }}
              >
                <IconTrash size={14} /> Delete Project
              </Button>
            )}
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={() => handleSaveProject()}
            disabled={!name.trim() || isSaving}
          >
            {isSaving ? "Saving..." : activeProj ? "Save Project" : "Create Project"}
          </Button>
        </div>

        {confirmDelete && activeProj && (
          <div className="settings-confirm-delete-box">
            <p style={{ fontSize: "0.82rem", margin: 0 }}>
              Delete <strong>{activeProj.name}</strong> and its {files.length} uploaded file(s)? Chats inside this project will stay in your main history.
            </p>
            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
              <Button variant="secondary" size="sm" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleDeleteProject}
                style={{ backgroundColor: "var(--danger, #ef4444)", borderColor: "transparent" }}
              >
                Confirm Delete
              </Button>
            </div>
          </div>
        )}

        {/* Project Reference Files */}
        <div className="settings-section" style={{ borderBottom: "none", paddingBottom: 0 }}>
          <div className="settings-row-header-between" style={{ marginBottom: "0.5rem" }}>
            <div>
              <span className="settings-item-title">Project Files ({files.length}/5)</span>
              <p className="settings-item-desc" style={{ margin: 0 }}>
                TXT, MD, CSV, JSON, code or PDF files (max ~50,000 chars each).
              </p>
            </div>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleProjectFileUpload}
              accept=".pdf,.txt,.md,.csv,.json,.js,.jsx,.ts,.tsx,.py,.html,.css,.sql,.sh,.yaml,.yml,.log"
              style={{ display: "none" }}
            />
            <Button
              variant="secondary"
              size="sm"
              disabled={files.length >= 5 || isUploading}
              onClick={() => fileInputRef.current?.click()}
            >
              <IconPlus size={14} /> {isUploading ? "Reading..." : "Add File"}
            </Button>
          </div>

          {fileError && (
            <div
              style={{
                padding: "8px 10px",
                borderRadius: "6px",
                backgroundColor: "rgba(239, 68, 68, 0.1)",
                color: "#fca5a5",
                fontSize: "0.78rem",
                marginBottom: "8px",
              }}
            >
              {fileError}
            </div>
          )}

          {fileNote && (
            <div className="settings-toast-banner" style={{ marginBottom: "8px" }}>
              <IconCheck size={14} />
              <span>{fileNote}</span>
            </div>
          )}

          <div className="settings-memories-list" style={{ maxHeight: "160px" }}>
            {files.length === 0 ? (
              <div className="settings-empty-memories" style={{ padding: "1rem" }}>
                No files attached yet. Add reference docs for project-aware answers.
              </div>
            ) : (
              files.map((f) => (
                <div key={f.id} className="settings-memory-card">
                  <div className="settings-memory-text-col">
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <IconFileText size={14} style={{ color: "var(--accent)" }} />
                      <span className="settings-memory-text" style={{ fontWeight: 500 }}>
                        {f.name}
                      </span>
                    </div>
                    <span className="settings-memory-date">
                      {formatFileSize(f.size)} · {f.content.length.toLocaleString()} chars extracted
                    </span>
                  </div>
                  <button
                    type="button"
                    className="settings-icon-action-btn danger"
                    title="Remove file"
                    onClick={() => activeProj && removeFileFromProject(activeProj.id, f.id)}
                  >
                    <IconTrash size={14} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Project Chats Quick Launcher */}
        {activeProj && (
          <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: "0.85rem" }}>
            <div className="settings-row-header-between" style={{ marginBottom: "0.5rem" }}>
              <span className="settings-item-title">
                Chats in this Project ({projectChats.length})
              </span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  createNewChat(activeProj.id);
                  onClose();
                }}
              >
                <IconPlus size={14} /> New Chat in Project
              </Button>
            </div>
            {projectChats.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                {projectChats.slice(0, 6).map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="settings-pill-btn"
                    onClick={() => {
                      selectChat(c.id);
                      onClose();
                    }}
                  >
                    <IconFolder size={12} style={{ marginRight: "4px" }} />
                    {c.title}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
};
