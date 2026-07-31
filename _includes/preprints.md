{% if site.data.preprints.main and site.data.preprints.main.size > 0 %}
<h1 id="preprints"></h1>

<h2 style="margin: 60px 0px -15px;">Preprints</h2>


<div class="publications">
<ol class="bibliography">

{% for link in site.data.preprints.main %}

<li>
{% assign pdf_url = link.pdf | default: '' %}
{% assign code_url = link.code | default: '' %}
{% assign page_url = link.page | default: '' %}
<div class="pub-row">
  <div class="col-sm-3 abbr" style="position: relative;padding-right: 15px;padding-left: 15px;">
    <img src="{{ link.image }}" class="teaser img-fluid z-depth-1" style="width=100;height=40%">
  </div>
  <div class="col-sm-9" style="position: relative;padding-right: 15px;padding-left: 20px;">
      <div class="title"><a{% if pdf_url != empty %} href="{{ pdf_url }}"{% endif %}>{{ link.title }}</a></div>
      <div class="author">{{ link.authors }}</div>
    <div class="links">
      {% if pdf_url != empty or link.placeholder_links %}
      <a href="{{ pdf_url }}" class="btn btn-sm z-depth-0" role="button" style="font-size:12px;"{% if pdf_url == empty %} aria-disabled="true" tabindex="-1" onclick="return false;"{% else %} target="_blank" rel="noopener"{% endif %}>PDF</a>
      {% endif %}
      {% if code_url != empty or link.placeholder_links %}
      <a href="{{ code_url }}" class="btn btn-sm z-depth-0" role="button" style="font-size:12px;"{% if code_url == empty %} aria-disabled="true" tabindex="-1" onclick="return false;"{% else %} target="_blank" rel="noopener"{% endif %}>Code</a>
      {% endif %}
      {% if page_url != empty or link.placeholder_links %}
      <a href="{{ page_url }}" class="btn btn-sm z-depth-0" role="button" style="font-size:12px;"{% if page_url == empty %} aria-disabled="true" tabindex="-1" onclick="return false;"{% else %} target="_blank" rel="noopener"{% endif %}>Project Page</a>
      {% endif %}
      {% if link.data %} 
      <a href="{{ link.data }}" class="btn btn-sm z-depth-0" role="button" target="_blank" style="font-size:12px;">Dataset</a>
      {% endif %}
      {% if link.bibtex %} 
      <a href="{{ link.bibtex }}" class="btn btn-sm z-depth-0" role="button" target="_blank" style="font-size:12px;">BibTex</a>
      {% endif %}
      {% if link.notes %} 
      <strong> <i style="color:#e74d3c">{{ link.notes }}</i></strong>
      {% endif %}
      {% if link.others %} 
      {{ link.others }}
      {% endif %}
    </div>
  </div>
</div>
</li>

<br>

{% endfor %}

</ol>
</div>
{% endif %}
