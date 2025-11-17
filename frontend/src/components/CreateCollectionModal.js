import React, { useCallback, useMemo } from 'react';

const CreateCollectionModal = ({
  showCreateCollection,
  setShowCreateCollection,
  newCollectionName,
  setNewCollectionName,
  newCollectionDescription,
  setNewCollectionDescription,
  newCollectionIsPrivate,
  setNewCollectionIsPrivate,
  handleCreateCollection
}) => {
  const handleOverlayClick = useCallback(() => {
    setShowCreateCollection(false);
  }, [setShowCreateCollection]);

  const handleModalClick = useCallback((e) => {
    e.stopPropagation();
  }, []);

  const handleCancelClick = useCallback(() => {
    setShowCreateCollection(false);
  }, [setShowCreateCollection]);

  const handleNameChange = useCallback((e) => {
    setNewCollectionName(e.target.value);
  }, [setNewCollectionName]);

  const handleDescriptionChange = useCallback((e) => {
    setNewCollectionDescription(e.target.value);
  }, [setNewCollectionDescription]);

  const handlePrivateChange = useCallback((e) => {
    setNewCollectionIsPrivate(e.target.checked);
  }, [setNewCollectionIsPrivate]);

  const isCreateButtonDisabled = useMemo(() => {
    return !newCollectionName.trim();
  }, [newCollectionName]);

  if (!showCreateCollection) return null;

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className="modal" onClick={handleModalClick}>
        <h3>Create New Collection</h3>
        <input
          key="collection-name-input"
          type="text"
          placeholder="Collection name"
          value={newCollectionName}
          onChange={handleNameChange}
          className="modal-input"
          maxLength={50}
        />
        <textarea
          key="collection-description-textarea"
          placeholder="Description (optional)"
          value={newCollectionDescription}
          onChange={handleDescriptionChange}
          className="modal-textarea"
          maxLength={200}
        />
        <label className="checkbox-wrapper">
          <input
            type="checkbox"
            checked={newCollectionIsPrivate}
            onChange={handlePrivateChange}
            className="checkbox-input"
          />
          <span className="checkbox-label">Private (login required to view)</span>
        </label>
        <div className="modal-actions">
          <button 
            className="modal-cancel-button"
            onClick={handleCancelClick}
          >
            Cancel
          </button>
          <button 
            className="modal-confirm-button"
            onClick={handleCreateCollection}
            disabled={isCreateButtonDisabled}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
};

export default React.memo(CreateCollectionModal);