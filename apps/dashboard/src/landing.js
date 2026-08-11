const form=document.querySelector("#landing-search");
const query=document.querySelector("#landing-query");
const inspect=document.querySelector("#landing-inspect");

export function getConsoleDestination(value){
  return value.trim()?`/console/?q=${encodeURIComponent(value)}`:"/console/";
}

function openConsole(event){
  event.preventDefault();
  window.location.assign(getConsoleDestination(query.value));
}

form.addEventListener("submit",openConsole);
inspect.addEventListener("click",openConsole);
