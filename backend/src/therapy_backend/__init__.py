def main() -> None:
    import uvicorn

    uvicorn.run("therapy_backend.main:app", host="127.0.0.1", port=8000, reload=True)
